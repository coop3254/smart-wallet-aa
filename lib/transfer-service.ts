import { createPublicClient, http, getContract, encodeFunctionData, encodePacked, parseAbi, parseErc6492Signature, formatUnits, hexToBigInt } from 'viem'
import { createBundlerClient } from 'viem/account-abstraction'
import { arbitrumSepolia } from 'viem/chains'
import { toEcdsaKernelSmartAccount } from 'permissionless/accounts'
import { privateKeyToAccount } from 'viem/accounts'
import { eip2612Abi, eip2612Permit, tokenAbi } from './permit-helpers'

const ARBITRUM_SEPOLIA_USDC = '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d'
const ARBITRUM_SEPOLIA_PAYMASTER = '0x7C5D876b446F3F1F08E2d3513D9062e681c4388C'
const ARBITRUM_SEPOLIA_BUNDLER = `https://public.pimlico.io/v2/${arbitrumSepolia.id}/rpc`

// The max amount allowed to be paid per user op
const MAX_GAS_USDC = 1000000n // 1 USDC

export async function transferUSDC(
  privateKey: `0x${string}`,
  recipientAddress: string,
  amount: bigint
) {
  // Create clients
  const client = createPublicClient({
    chain: arbitrumSepolia,
    transport: http()
  })

  const bundlerClient = createBundlerClient({
    client,
    transport: http(ARBITRUM_SEPOLIA_BUNDLER)
  })

  // Create accounts
  const owner = privateKeyToAccount(privateKey)
  const account = await toEcdsaKernelSmartAccount({
    client,
    owners: [owner],
    version: '0.3.1'
  })

  // Setup USDC contract
  const usdc = getContract({
    client,
    address: ARBITRUM_SEPOLIA_USDC,
    abi: tokenAbi,
  })

  // Construct and sign permit
  console.log('Constructing and signing permit...')
  const permitData = await eip2612Permit({
    token: usdc,
    chain: arbitrumSepolia,
    ownerAddress: account.address,
    spenderAddress: ARBITRUM_SEPOLIA_PAYMASTER,
    value: MAX_GAS_USDC
  })

  const signData = { ...permitData, primaryType: 'Permit' as const }
  const wrappedPermitSignature = await account.signTypedData(signData)
  const { signature: permitSignature } = parseErc6492Signature(wrappedPermitSignature)
  console.log('Permit signature:', permitSignature)

  // Prepare transfer call
  const calls = [{
    to: usdc.address,
    abi: usdc.abi,
    functionName: 'transfer',
    args: [recipientAddress, amount]
  }]

  // Specify the USDC Token Paymaster
  const paymaster = ARBITRUM_SEPOLIA_PAYMASTER
  const paymasterData = encodePacked(
    ['uint8', 'address', 'uint256', 'bytes'],
    [
      0, // Reserved for future use
      usdc.address, // Token address
      MAX_GAS_USDC, // Max spendable gas in USDC
      permitSignature // EIP-2612 permit signature
    ]
  )

  // Get additional gas charge from paymaster
  const additionalGasCharge = hexToBigInt(
    (
      await client.call({
        to: paymaster,
        data: encodeFunctionData({
          abi: parseAbi(['function additionalGasCharge() returns (uint256)']),
          functionName: 'additionalGasCharge'
        })
      }) ?? { data: '0x0' }
    ).data
  )
  console.log('Additional gas charge (paymasterPostOpGasLimit):', additionalGasCharge)

  // Get current gas prices
  const { standard: fees } = await bundlerClient.request({
    method: 'pimlico_getUserOperationGasPrice' as any
  }) as { standard: { maxFeePerGas: `0x${string}`, maxPriorityFeePerGas: `0x${string}` } }
  const maxFeePerGas = hexToBigInt(fees.maxFeePerGas)
  const maxPriorityFeePerGas = hexToBigInt(fees.maxPriorityFeePerGas)
  console.log('Max fee per gas:', maxFeePerGas)
  console.log('Max priority fee per gas:', maxPriorityFeePerGas)

  // Estimate gas limits
  console.log('Estimating user op gas limits...')
  const {
    callGasLimit,
    preVerificationGas,
    verificationGasLimit,
    paymasterPostOpGasLimit,
    paymasterVerificationGasLimit
  } = await bundlerClient.estimateUserOperationGas({
    account,
    calls,
    paymaster,
    paymasterData,
    paymasterPostOpGasLimit: additionalGasCharge,
    maxFeePerGas: 1n,
    maxPriorityFeePerGas: 1n
  })
  console.log('Call gas limit:', callGasLimit)
  console.log('Pre-verification gas:', preVerificationGas)
  console.log('Verification gas limit:', verificationGasLimit)
  console.log('Paymaster post op gas limit:', paymasterPostOpGasLimit)
  console.log('Paymaster verification gas limit:', paymasterVerificationGasLimit)

  // Send user operation
  console.log('Sending user op...')
  const userOpHash = await bundlerClient.sendUserOperation({
    account,
    calls,
    callGasLimit,
    preVerificationGas,
    verificationGasLimit,
    paymaster,
    paymasterData,
    paymasterVerificationGasLimit,
    paymasterPostOpGasLimit: BigInt(Math.max(
      Number(paymasterPostOpGasLimit),
      Number(additionalGasCharge)
    )),
    maxFeePerGas,
    maxPriorityFeePerGas
  })
  console.log('Submitted user op:', userOpHash)

  // Wait for receipt
  console.log('Waiting for execution...')
  const userOpReceipt = await bundlerClient.waitForUserOperationReceipt({
    hash: userOpHash
  })
  console.log('Done! Details:')
  console.log('  success:', userOpReceipt.success)
  console.log('  actualGasUsed:', userOpReceipt.actualGasUsed)
  console.log(
    '  actualGasCost:',
    formatUnits(userOpReceipt.actualGasCost, 18),
    'ETH'
  )
  console.log('  transaction hash:', userOpReceipt.receipt.transactionHash)
  console.log('  transaction gasUsed:', userOpReceipt.receipt.gasUsed)

  // Calculate USDC consumed
  const usdcBalanceBefore = await usdc.read.balanceOf([account.address])
  const usdcBalanceAfter = await usdc.read.balanceOf([account.address])
  const usdcConsumed = usdcBalanceBefore - usdcBalanceAfter - amount
  console.log('  USDC paid:', formatUnits(usdcConsumed, 6))

  return userOpReceipt
}

