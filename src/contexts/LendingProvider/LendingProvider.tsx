import React, { createContext, useEffect, useState } from 'react'

import { useWallet } from 'use-wallet'

import { Lending } from 'lending-sdk/lib'

export interface LendingContext {
  lending?: any
}

export const Context = createContext<LendingContext>({
  lending: undefined,
})

declare global {
  interface Window {
    Lendingsauce: any
  }
}

interface LendingProps {
  chain_id:string
}
const LendingProvider: React.FC<LendingProps> = ({ children,chain_id }) => {
  const { ethereum, chainId, account, connect, connector, status,reset } = useWallet()
  const [lending, setLending] = useState<any>()
  useEffect(() => {
    if (ethereum) {
      const LendingLib = new Lending(
        ethereum,
        chain_id,
        {
          defaultAccount: account,
          defaultConfirmations: 1,
          autoGasMultiplier: 1.5,
          testing: false,
          defaultGas: "6000000",
          defaultGasPrice: "1000000000000",
          accounts: [],
          ethereumNodeTimeout: 10000
        }
      )
      setLending(LendingLib)
      window.Lendingsauce = LendingLib
    }
    // else{
    //   setLending(undefined)
    // }
  }, [ethereum,account])

  return (
    <Context.Provider value={{ lending }}>
      {children}
    </Context.Provider>
  )
}

export default LendingProvider
