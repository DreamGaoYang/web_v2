import { useContext } from 'react'
import { Context } from '../contexts/LendingProvider'

const useLending = () => {
  const { lending } = useContext(Context)
  return lending
}

export default useLending