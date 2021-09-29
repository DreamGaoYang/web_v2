import BigNumber from 'bignumber.js/bignumber';
import * as Types from "./types.js";
import { SUBTRACT_GAS_LIMIT } from './constants.js';

import ERC20Json from '../clean_build/contracts/IERC20.json';
import ETHJson from '../clean_build/contracts/ETH.json';
// import DL_ETHJson from '../clean_build/contracts/DL_ETH.json';
import LendingData from '../clean_build/contracts/LendingData.json'
import Controller from '../clean_build/contracts/Controller.json'
import DL_Token from '../clean_build/contracts/DL_Token.json';

const assignObj = (that,fileJson,networkId,account)=>{
  for (const key in fileJson.networks[networkId]) {
    that[key] = {
      ...fileJson.networks[networkId][key],
      "abi":fileJson["abi"],
      "gasToken":fileJson.networks[networkId][key]["gasToken"],
      ...new that.web3.eth.Contract(fileJson.abi, fileJson.networks[networkId][key]["address"]),
      "json":fileJson,
      "options":{
        "address":fileJson.networks[networkId][key]["address"],
        "from":account
      }
    }
  }
  return that
}

export class Contracts {
  constructor(
    provider,
    networkId,
    web3,
    options
  ) {
    try {
      this.web3 = web3;
      this.defaultConfirmations = options.defaultConfirmations;
      this.autoGasMultiplier = options.autoGasMultiplier || 1.5;
      this.confirmationType = options.confirmationType || Types.ConfirmationType.Confirmed;
      this.defaultGas = options.defaultGas;
      this.defaultGasPrice = options.defaultGasPrice;
      const account = this.web3.eth.defaultAccount
      const contractsArr = {
        ...assignObj(this,Controller,networkId,account),
        ...assignObj(this,LendingData,networkId,account),
        ...assignObj(this,ERC20Json,networkId,account),
        ...assignObj(this,DL_Token,networkId,account),
        ...assignObj(this,ETHJson,networkId,account)
        // ...assignObj(this,DL_ETHJson,networkId,account)
      }
      this.setProvider(provider, networkId);
    } catch (error) {
      console.log(error)    
    }
  }

  
  setProvider(
    provider,
    networkId
  ) {

    let contracts = Object.keys(this).map(key=>{
      if(this[key] instanceof Object && (key !== 'web3')){
        return { 
          "contract": this[key], 
          "json": this[key]["abi"]
        }
      }
    })
    
    // 过滤掉 不是 key => tokenContract 的 key
    contracts = contracts.filter((contract)=>contract !== undefined)
    contracts.forEach(contract => this.setContractProvider(
        contract.contract,
        contract.json,
        provider,
        networkId,
      ),
    );
  }

  async callContractFunction(
    method,
    options
  ) {
    const { confirmations, confirmationType, autoGasMultiplier, ...txOptions } = options;

    if (!this.blockGasLimit) {
      await this.setGasLimit();
    }

    if (!txOptions.gasPrice && this.defaultGasPrice) {
      txOptions.gasPrice = this.defaultGasPrice;
    }

    if (confirmationType === Types.ConfirmationType.Simulate || !options.gas) {
      let gasEstimate;
      if (this.defaultGas && confirmationType !== Types.ConfirmationType.Simulate) {
        txOptions.gas = this.defaultGas;
      } else {
        try {
          console.log("estimating gas");
          gasEstimate = await method.estimateGas(txOptions);
        } catch (error) {
          const data = method.encodeABI();
          const { from, value } = options;
          const to = method._parent._address;
          error.transactionData = { from, value, data, to };
          throw error;
        }

        const multiplier = autoGasMultiplier || this.autoGasMultiplier;
        const totalGas = Math.floor(gasEstimate * multiplier);
        txOptions.gas = totalGas < this.blockGasLimit ? totalGas : this.blockGasLimit;
      }

      if (confirmationType === Types.ConfirmationType.Simulate) {
        let g = txOptions.gas;
        return { gasEstimate, g };
      }
    }

    if (txOptions.value) {
      txOptions.value = new BigNumber(txOptions.value).toFixed(0);
    } else {
      txOptions.value = '0';
    }

    const promi = method.send(txOptions);

    const OUTCOMES = {
      INITIAL: 0,
      RESOLVED: 1,
      REJECTED: 2,
    };

    let hashOutcome = OUTCOMES.INITIAL;
    let confirmationOutcome = OUTCOMES.INITIAL;

    const t = confirmationType !== undefined ? confirmationType : this.confirmationType;

    if (!Object.values(Types.ConfirmationType).includes(t)) {
      throw new Error(`Invalid confirmation type: ${t}`);
    }

    let hashPromise;
    let confirmationPromise;

    if (t === Types.ConfirmationType.Hash || t === Types.ConfirmationType.Both) {
      hashPromise = new Promise(
        (resolve, reject) => {
          promi.on('error', (error) => {
            if (hashOutcome === OUTCOMES.INITIAL) {
              hashOutcome = OUTCOMES.REJECTED;
              reject(error);
              const anyPromi = promi ;
              anyPromi.off();
            }
          });

          promi.on('transactionHash', (txHash) => {
            if (hashOutcome === OUTCOMES.INITIAL) {
              hashOutcome = OUTCOMES.RESOLVED;
              resolve(txHash);
              if (t !== Types.ConfirmationType.Both) {
                const anyPromi = promi ;
                anyPromi.off();
              }
            }
          });
        },
      );
    }

    if (t === Types.ConfirmationType.Confirmed || t === Types.ConfirmationType.Both) {
      confirmationPromise = new Promise(
        (resolve, reject) => {
          promi.on('error', (error) => {
            if (
              (t === Types.ConfirmationType.Confirmed || hashOutcome === OUTCOMES.RESOLVED)
              && confirmationOutcome === OUTCOMES.INITIAL
            ) {
              confirmationOutcome = OUTCOMES.REJECTED;
              reject(error);
              const anyPromi = promi ;
              anyPromi.off();
            }
          });

          const desiredConf = confirmations || this.defaultConfirmations;
          if (desiredConf) {
            promi.on('confirmation', (confNumber, receipt) => {
              if (confNumber >= desiredConf) {
                if (confirmationOutcome === OUTCOMES.INITIAL) {
                  confirmationOutcome = OUTCOMES.RESOLVED;
                  resolve(receipt);
                  const anyPromi = promi ;
                  anyPromi.off();
                }
              }
            });
          } else {
            promi.on('receipt', (receipt) => {
              confirmationOutcome = OUTCOMES.RESOLVED;
              resolve(receipt);
              const anyPromi = promi ;
              anyPromi.off();
            });
          }
        },
      );
    }

    if (t === Types.ConfirmationType.Hash) {
      const transactionHash = await hashPromise;
      if (this.notifier) {
          this.notifier.hash(transactionHash)
      }
      return { transactionHash };
    }

    if (t === Types.ConfirmationType.Confirmed) {
      return confirmationPromise;
    }

    const transactionHash = await hashPromise;
    if (this.notifier) {
        this.notifier.hash(transactionHash)
    }
    return {
      transactionHash,
      confirmation: confirmationPromise,
    };
  }

  async callConstantContractFunction(
    method,
    options
  ) {
    const m2 = method;
    const { blockNumber, ...txOptions } = options;
    return m2.call(txOptions, blockNumber);
  }

  async setGasLimit() {
    const block = await this.web3.eth.getBlock('latest');
    this.blockGasLimit = block.gasLimit - SUBTRACT_GAS_LIMIT;
  }

  setContractProvider(
    contract,
    contractJson,
    provider,
    networkId,
  ){
    contract.setProvider(provider);
    console.log(this)
    try {
      // contract.options.address = contractJson.networks[networkId]
      //   && contractJson.networks[networkId].address;
    } catch (error) {
      // console.log(error)
    }
  }
}
