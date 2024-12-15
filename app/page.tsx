'use client'

import { useState, useEffect } from 'react'
import { ethers } from 'ethers'
import { useAccount } from 'wagmi'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { Loader2 } from 'lucide-react'
import { createPublicClient, http, formatUnits } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { arbitrumSepolia } from 'viem/chains'
import { toEcdsaKernelSmartAccount } from 'permissionless/accounts'

// Add import for transfer service
import { transferUSDC } from '@/lib/transfer-service'

const ARBITRUM_SEPOLIA_USDC = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'

export default function SmartWallet() {
  const [loading, setLoading] = useState(false)
  const [account, setAccount] = useState<any>(null)
  const [balance, setBalance] = useState<string>('')
  const [recipientAddress, setRecipientAddress] = useState('')
  const [amount, setAmount] = useState('')
  const [status, setStatus] = useState('')
  const { address, isConnected } = useAccount()
  const [usdcBalance, setUsdcBalance] = useState<string>('0.00')

  useEffect(() => {
    const fetchBalance = async () => {
      if (!account?.address) return
      
      const client = createPublicClient({
        chain: arbitrumSepolia,
        transport: http()
      })

      const balance = await client.readContract({
        address: ARBITRUM_SEPOLIA_USDC,
        abi: [{
          inputs: [{ name: 'account', type: 'address' }],
          name: 'balanceOf',
          outputs: [{ name: '', type: 'uint256' }],
          stateMutability: 'view',
          type: 'function'
        }],
        functionName: 'balanceOf',
        args: [account.address]
      })

      const formattedBalance = Number(formatUnits(balance as bigint, 6)).toFixed(2)
      setUsdcBalance(formattedBalance)
    }

    fetchBalance()
    // Set up polling interval
    const interval = setInterval(fetchBalance, 10000) // Poll every 10 seconds
    return () => clearInterval(interval)
  }, [account?.address])

  const createAccount = async () => {
    try {
      setLoading(true)
      setStatus('Creating smart account...')

      // Create RPC client
      const client = createPublicClient({
        chain: arbitrumSepolia,
        transport: http()
      })

      // Generate private key and create owner account
      const privateKey = generatePrivateKey()
      const owner = privateKeyToAccount(privateKey)

      // Create smart account
      const smartAccount = await toEcdsaKernelSmartAccount({
        client,
        owners: [owner],
        version: '0.3.1'
      })

      setAccount({
        address: smartAccount.address,
        owner: owner.address,
        privateKey: `0x${privateKey.slice(2)}`
      })

      setStatus('Smart account created successfully!')
    } catch (error) {
      setStatus('Error creating smart account: ' + (error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  const transfer = async () => {
    try {
      setLoading(true)
      setStatus('Initiating transfer...')

      const amountInWei = BigInt(parseFloat(amount) * 1000000) // Convert to USDC decimals

      const receipt = await transferUSDC(
        account.privateKey,
        recipientAddress,
        amountInWei
      )

      if (receipt.success) {
        setStatus('Transfer completed successfully!')
        setRecipientAddress('')
        setAmount('')
      } else {
        setStatus('Transfer failed. Please try again.')
      }
    } catch (error) {
      setStatus('Error during transfer: ' + (error as Error).message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <>
      {account && (
        <div className="fixed top-4 right-4 bg-card rounded-lg border shadow p-3">
          <span className="text-sm font-medium">USDC Balance: </span>
          <span className="font-mono">${usdcBalance}</span>
        </div>
      )}
      <div className="container max-w-2xl mx-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle>Smart Wallet Interface</CardTitle>
            <CardDescription>Create and manage your smart account with Circle's USDC Paymaster</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="create" className="space-y-4">
              <TabsList>
                <TabsTrigger value="create">Create Account</TabsTrigger>
                <TabsTrigger value="transfer" disabled={!account}>Transfer</TabsTrigger>
              </TabsList>

              <TabsContent value="create" className="space-y-4">
                {!account ? (
                  <Button 
                    onClick={createAccount} 
                    disabled={loading}
                    className="w-full"
                  >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Create Smart Account
                  </Button>
                ) : (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Smart Wallet Address</Label>
                      <Alert>
                        <AlertDescription className="font-mono break-all">
                          {account.address}
                        </AlertDescription>
                      </Alert>
                    </div>
                    <div className="space-y-2">
                      <Label>Owner Address</Label>
                      <Alert>
                        <AlertDescription className="font-mono break-all">
                          {account.owner}
                        </AlertDescription>
                      </Alert>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="transfer" className="space-y-4">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="recipient">Recipient Address</Label>
                    <Input
                      id="recipient"
                      placeholder="0x..."
                      value={recipientAddress}
                      onChange={(e) => setRecipientAddress(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="amount">Amount (USDC)</Label>
                    <Input
                      id="amount"
                      type="number"
                      placeholder="0.00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </div>
                  <Button 
                    onClick={transfer} 
                    disabled={loading || !recipientAddress || !amount}
                    className="w-full"
                  >
                    {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                    Transfer USDC
                  </Button>
                </div>
              </TabsContent>
            </Tabs>

            {status && (
              <Alert className="mt-4">
                <AlertDescription>{status}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  )
}

