#!/usr/bin/env node

import 'dotenv/config'

import chalk from 'chalk'
import inquirer from 'inquirer'
import ora from 'ora'
import { table } from 'table'

// Import business logic modules
import { readExistingConfig, saveConfig, type Config } from './config'
import { registerUser, loginUser, signOut, type RegisterData, type LoginData } from './auth'
import { createRoom, connectToExistingRoom, disconnectFromRoom } from './joinRoom'
import { getUserProfiles, getRoomMembersExcluding } from './user'
import { initWebRTC, broadcast, onMessage, cleanup, connectToPeer } from './webrtc'
import { listenForHostChanges } from './hostElection'
import { transferHost } from './hostElection'

// ============= UI HELPERS =============

function printHeader() {
  console.clear()
  console.log(
    chalk.cyan.bold(
      `
╔════════════════════════════════════════════════════════════╗
║          P2P WebRTC Terminal CLI - v1.0                    ║
║          Modern Terminal-based Connection Manager          ║
╚════════════════════════════════════════════════════════════╝
    `
    )
  )
}

interface SessionState {
  userId: string | null
  username: string | null
  roomId: string | null
  isConnected: boolean
  isHost: boolean
  peers: string[]
  role: string | null
  session?: any
  autoConnect: boolean
}

let state: SessionState = {
  userId: null,
  username: null,
  roomId: null,
  isConnected: false,
  isHost: false,
  peers: [],
  role: null,
  session: undefined,
  autoConnect: false,
}

function printStatus() {
  const roleDisplay = state.roomId 
    ? (state.isHost ? chalk.yellow('🌟 Host') : chalk.cyan('👤 Client'))
    : chalk.gray('Not in room')
  
  const data = [
    [chalk.blue.bold('Property'), chalk.blue.bold('Value')],
    ['Username', state.username ? chalk.green(state.username) : chalk.gray('Unknown')],
    ['User ID', state.userId ? chalk.green(state.userId.substring(0, 16) + '...') : chalk.red('Not connected')],
    ['Room ID', state.roomId ? chalk.green(state.roomId) : chalk.gray('None')],
    ['Connected', state.isConnected ? chalk.green('✓ Yes') : chalk.red('✗ No')],
    ['Role', roleDisplay],
    ['Peers Connected', chalk.magenta(state.peers.length.toString())],
  ]

  console.log('\n' + table(data))
}

function printHelp() {
  console.log(
    chalk.cyan.bold('\n📋 Available Commands:') +
      chalk.gray(`
  1. Create Room           - Create and host a new WebRTC room
  2. Connect to Room       - Join or create a WebRTC room
  3. Send Message          - Send a message to all peers
  4. View Status           - Display current connection status
  5. List Peers            - Show all connected peers
  6. Connect to Peers      - Connect to peers in room (Host only)
  7. Transfer Host Role    - Transfer host role to another user (Host only)
  8. Leave Room            - Disconnect from current room
  9. Switch Account        - Sign in or register a different user
  10. Exit                 - Close the application
  
  💡 Tip: Type "back" in any input field or select "← Back" in menus to cancel
  `)
  )
}

function printSuccess(msg: string) {
  console.log(chalk.green.bold('✓ ' + msg))
}

function printError(msg: string) {
  console.log(chalk.red.bold('✗ ' + msg))
}

function printInfo(msg: string) {
  console.log(chalk.blue.bold('ℹ ' + msg))
}

// ============= TUI PROMPTS =============

async function promptForConfig(): Promise<Config> {
  const existingEnv = readExistingConfig()

  console.log(chalk.cyan.bold('\n╔════════════════════════════════════════════════════════════╗'))
  console.log(chalk.cyan.bold('║          🔐 P2P WebRTC - Supabase Configuration            ║'))
  console.log(chalk.cyan.bold('╚════════════════════════════════════════════════════════════╝\n'))

  console.log(chalk.cyan.bold('📍 Supabase Credentials'))
  console.log(chalk.gray('Get these from: https://supabase.com → Your Project → Settings → API\n'))

  const supabaseAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'supabaseUrl',
      message: chalk.cyan('📌 Supabase Project URL:'),
      default: existingEnv['SUPABASE_URL'] || undefined,
      validate: (input: string) => {
        if (!input) return 'URL is required'
        if (!input.includes('supabase.co')) return 'Must be a valid Supabase URL (*.supabase.co)'
        return true
      },
      prefix: chalk.magenta('?'),
    },
    {
      type: 'password',
      name: 'supabaseKey',
      message: chalk.cyan('🔑 Supabase Anon Key (hidden):'),
      mask: '*',
      validate: (input: string) => {
        if (!input) return 'Key is required'
        if (input.length < 20) return 'Key seems too short'
        return true
      },
      prefix: chalk.magenta('?'),
    },
  ])

  console.log('\n' + chalk.cyan.bold('🌐 Advanced (Optional)'))
  const advancedAnswers = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'useTurn',
      message: chalk.cyan('Configure TURN server? (for better connectivity)'),
      default: false,
      prefix: chalk.magenta('?'),
    },
  ])

  let turnUrl = existingEnv['TURN_URL'] || ''
  let turnUser = existingEnv['TURN_USER'] || ''
  let turnPass = existingEnv['TURN_PASS'] || ''

  if (advancedAnswers.useTurn) {
    const turnAnswers = await inquirer.prompt([
      {
        type: 'input',
        name: 'turnUrl',
        message: chalk.cyan('TURN server URL:'),
        default: turnUrl || undefined,
        prefix: chalk.magenta('?'),
      },
      {
        type: 'input',
        name: 'turnUser',
        message: chalk.cyan('TURN username (optional):'),
        default: turnUser || undefined,
        prefix: chalk.magenta('?'),
      },
      {
        type: 'password',
        name: 'turnPass',
        message: chalk.cyan('TURN password (optional):'),
        mask: '*',
        prefix: chalk.magenta('?'),
      },
    ])
    turnUrl = turnAnswers.turnUrl
    turnUser = turnAnswers.turnUser
    turnPass = turnAnswers.turnPass
  }

  return {
    supabaseUrl: supabaseAnswers.supabaseUrl,
    supabaseKey: supabaseAnswers.supabaseKey,
    turnUrl: turnUrl || undefined,
    turnUser: turnUser || undefined,
    turnPass: turnPass || undefined,
  }
}

async function promptForAuth(): Promise<'register' | 'login'> {
  const authChoice = await inquirer.prompt([
    {
      type: 'list',
      name: 'choice',
      message: chalk.cyan('What would you like to do?'),
      choices: [
        { name: chalk.green('Create a new account'), value: 'register' },
        { name: chalk.blue('Sign in to existing account'), value: 'login' },
      ],
      prefix: chalk.magenta('?'),
    },
  ])
  return authChoice.choice
}

async function promptForRegister(): Promise<RegisterData> {
  console.log(chalk.cyan.bold('\n📝 Create New Account\n'))
  
  const regAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'username',
      message: chalk.cyan('Choose a username:'),
      validate: (input: string) => {
        if (!input.trim()) return 'Username is required'
        if (input.length < 2) return 'Username must be at least 2 characters'
        if (input.length > 30) return 'Username must be less than 30 characters'
        return true
      },
      prefix: chalk.magenta('?'),
    },
    {
      type: 'input',
      name: 'email',
      message: chalk.cyan('Email address:'),
      validate: (input: string) => {
        if (!input.trim()) return 'Email is required'
        if (!input.includes('@')) return 'Must be a valid email'
        return true
      },
      prefix: chalk.magenta('?'),
    },
    {
      type: 'password',
      name: 'password',
      message: chalk.cyan('Create a password:'),
      mask: '*',
      validate: (input: string) => {
        if (!input) return 'Password is required'
        if (input.length < 6) return 'Password must be at least 6 characters'
        return true
      },
      prefix: chalk.magenta('?'),
    },
    {
      type: 'password',
      name: 'confirmPassword',
      message: chalk.cyan('Confirm password:'),
      mask: '*',
      validate: (input: string, answers: any) => {
        if (input !== answers.password) return 'Passwords do not match'
        return true
      },
      prefix: chalk.magenta('?'),
    },
  ])

  return {
    username: regAnswers.username.trim(),
    email: regAnswers.email,
    password: regAnswers.password,
  }
}

async function promptForLogin(): Promise<LoginData> {
  console.log(chalk.cyan.bold('\n🔐 Sign In\n'))
  
  const loginAnswers = await inquirer.prompt([
    {
      type: 'input',
      name: 'email',
      message: chalk.cyan('Email address:'),
      validate: (input: string) => {
        if (!input.trim()) return 'Email is required'
        if (!input.includes('@')) return 'Must be a valid email'
        return true
      },
      prefix: chalk.magenta('?'),
    },
    {
      type: 'password',
      name: 'password',
      message: chalk.cyan('Password:'),
      mask: '*',
      validate: (input: string) => {
        if (!input) return 'Password is required'
        return true
      },
      prefix: chalk.magenta('?'),
    },
  ])

  return {
    email: loginAnswers.email,
    password: loginAnswers.password,
  }
}

// ============= TUI HANDLERS =============

async function setupOnboarding(): Promise<void> {
  const config = await promptForConfig()
  saveConfig(config)
  console.log('\n' + chalk.green.bold('✓ Supabase configuration saved!'))
  console.log(chalk.gray('  Configuration saved to: .env\n'))
}

async function initializeSession(): Promise<void> {
  // Clear any existing session first to prevent auto-sign-in
  try {
    await signOut()
  } catch (e) {
    // Ignore errors if no session exists
  }
  
  const authType = await promptForAuth()
  
  let authResult

  try {
    if (authType === 'register') {
      const registerData = await promptForRegister()
      const spinner = ora({ text: 'Creating account...', color: 'cyan' }).start()
      authResult = await registerUser(registerData)
      spinner.succeed(chalk.green('Account created successfully!'))
    } else {
      const loginData = await promptForLogin()
      // Ensure we're signed out before attempting login
      await signOut()
      const spinner = ora({ text: 'Signing in...', color: 'cyan' }).start()
      authResult = await loginUser(loginData)
      spinner.succeed(chalk.green('Signed in successfully!'))
    }

    // Use the session from auth result
    state.session = authResult.session
    state.userId = authResult.userId
    state.username = authResult.username
    printSuccess(`Logged in as: ${authResult.username || authResult.userId}`)
  } catch (error) {
    printError(`${error instanceof Error ? error.message : String(error)}`)
    
    // Retry once
    try {
      const retryAuthType = await promptForAuth()
      let retryResult
      
      if (retryAuthType === 'register') {
        const registerData = await promptForRegister()
        retryResult = await registerUser(registerData)
      } else {
        const loginData = await promptForLogin()
        retryResult = await loginUser(loginData)
      }
      
      state.session = retryResult.session
      state.userId = retryResult.userId
      state.username = retryResult.username
      printSuccess(`Logged in as: ${retryResult.username || retryResult.userId}`)
    } catch (retryError) {
      printError(`Failed to authenticate: ${retryError instanceof Error ? retryError.message : String(retryError)}`)
      process.exit(1)
    }
  }
}

async function switchAccount(): Promise<void> {
  try {
    // Disconnect from room if connected
    if (state.roomId) {
      try {
        await disconnectFromRoom(state.roomId)
        state.roomId = null
        state.isConnected = false
        state.isHost = false
        state.role = null
        state.peers = []
      } catch (e) {
        // Continue even if disconnect fails
      }
    }

    // Clear any existing session first
    try {
      await signOut()
    } catch (e) {
      // Ignore errors if no session exists
    }
    
    const authType = await promptForAuth()
    let authResult
    
    try {
      if (authType === 'register') {
        const registerData = await promptForRegister()
        const spinner = ora({ text: 'Creating account...', color: 'cyan' }).start()
        try {
          authResult = await registerUser(registerData)
          spinner.succeed(chalk.green('Account created successfully!'))
        } catch (err) {
          spinner.fail(chalk.red('Account creation failed'))
          throw err
        }
      } else {
        const loginData = await promptForLogin()
        // Ensure we're signed out before attempting login
        await signOut()
        const spinner = ora({ text: 'Signing in...', color: 'cyan' }).start()
        try {
          authResult = await loginUser(loginData)
          spinner.succeed(chalk.green('Signed in successfully!'))
        } catch (err) {
          spinner.fail(chalk.red('Sign in failed'))
          throw err
        }
      }
      
      state.session = authResult.session
      state.userId = authResult.userId
      state.username = authResult.username
      printSuccess(`Logged in as: ${authResult.username || authResult.userId}`)
    } catch (err) {
      printError(`${err instanceof Error ? err.message : String(err)}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      return
    }
    printError(`${error instanceof Error ? error.message : String(error)}`)
  }
}

async function handleCreateRoom(): Promise<void> {
  try {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'roomName',
        message: chalk.cyan('Room name:'),
        validate: (input: string) => {
          return input.trim().length > 0 || 'Room name cannot be empty'
        },
        prefix: chalk.magenta('?'),
      },
      {
        type: 'list',
        name: 'confirm',
        message: '',
        choices: [
          { name: chalk.green('Continue'), value: 'continue' },
          { name: chalk.gray('← Back'), value: 'back' },
        ],
        prefix: '',
      },
    ])

    if (answers.confirm === 'back') {
      return
    }

    const autoConnectAnswer = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'autoConnect',
        message: chalk.cyan('Enable auto-connect? (Clients will automatically connect to host)'),
        default: true,
        prefix: chalk.magenta('?'),
      },
    ])

    const spinner = ora({ text: `Creating room ${answers.roomName}...`, color: 'cyan' }).start()

    try {
      const result = await createRoom(answers.roomName.trim(), autoConnectAnswer.autoConnect)
      
      listenForHostChanges(result.roomId, (newHostId: any) => {
        state.isHost = newHostId === state.userId
        printInfo(`Host changed to ${newHostId?.substring(0, 8) || 'unknown'}`)
      })

      state.roomId = result.roomId
      state.role = result.role
      state.isConnected = true
      state.isHost = result.isHost
      state.autoConnect = result.autoConnect || false
      state.peers = []

      spinner.succeed(chalk.green(`Created and connected to room: ${result.roomId}`))
      printSuccess('Joined as host')

      onMessage((msg: any, peerId: any) => {
        if (msg.type === 'chat') {
          console.log(chalk.yellow(`\n📨 Message from ${peerId.substring(0, 8)}:`), chalk.white(msg.text))
        }
      })
    } catch (error) {
      spinner.fail(chalk.red('Create room failed'))
      printError(`${error instanceof Error ? error.message : String(error)}`)
      state.isConnected = false
      throw error
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      return
    }
    printError(`Failed to create room: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function handleConnectToRoom(): Promise<void> {
  try {
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'roomId',
        message: chalk.cyan('Enter Room ID:'),
        validate: (input: string) => {
          return input.trim().length > 0 || 'Room ID cannot be empty'
        },
        prefix: chalk.magenta('?'),
      },
      {
        type: 'list',
        name: 'confirm',
        message: '',
        choices: [
          { name: chalk.green('Continue'), value: 'continue' },
          { name: chalk.gray('← Back'), value: 'back' },
        ],
        prefix: '',
      },
    ])

    if (answers.confirm === 'back') {
      return
    }

    const roleAnswer = await inquirer.prompt([
      {
        type: 'list',
        name: 'role',
        message: chalk.cyan('Select your role:'),
        choices: [
          { name: 'Host', value: 'host' },
          { name: 'Client', value: 'client' },
          { name: chalk.gray('← Back'), value: 'back' },
        ],
        prefix: chalk.magenta('?'),
      },
    ])

    if (roleAnswer.role === 'back') {
      return
    }

    const roomId = answers.roomId.trim()
    const role = roleAnswer.role
    const spinner = ora({ text: `Connecting to room ${roomId}...`, color: 'cyan' }).start()

    try {
      const result = await connectToExistingRoom(roomId, role)

      listenForHostChanges(roomId, (newHostId: any) => {
        state.isHost = newHostId === state.userId
        printInfo(`Host changed to ${newHostId?.substring(0, 8) || 'unknown'}`)
      })

      state.roomId = result.roomId
      state.role = result.role
      state.isConnected = true
      state.isHost = result.isHost

      spinner.succeed(chalk.green(`Connected to room: ${roomId}`))
      printSuccess(`Joined as ${role}`)

      onMessage((msg: any, peerId: any) => {
        if (msg.type === 'chat') {
          console.log(chalk.yellow(`\n📨 Message from ${peerId.substring(0, 8)}:`), chalk.white(msg.text))
        }
      })
    } catch (error) {
      spinner.fail(chalk.red('Connection failed'))
      printError(`${error instanceof Error ? error.message : String(error)}`)
      state.isConnected = false
      throw error
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      return
    }
    printError(`Failed to connect to room: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function handleSendMessage(): Promise<void> {
  try {
    if (!state.isConnected) {
      printError('Not connected to any room')
      return
    }

    const answer = await inquirer.prompt([
      {
        type: 'input',
        name: 'message',
        message: chalk.cyan('Enter message:'),
        validate: (input: string) => {
          return input.trim().length > 0 || 'Message cannot be empty'
        },
        prefix: chalk.magenta('?'),
      },
      {
        type: 'list',
        name: 'confirm',
        message: '',
        choices: [
          { name: chalk.green('Continue'), value: 'continue' },
          { name: chalk.gray('← Back'), value: 'back' },
        ],
        prefix: '',
      },
    ])

    if (answer.confirm === 'back') {
      return
    }

    try {
      await broadcast({ type: 'chat', text: answer.message })
      printSuccess('Message sent to all peers')
    } catch (error) {
      printError(`${error instanceof Error ? error.message : String(error)}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      return
    }
    printError(`Failed to send message: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function handleListPeers(): Promise<void> {
  try {
    if (!state.isConnected || !state.roomId) {
      printError('Not connected to any room')
      return
    }

    const spinner = ora({ text: 'Fetching peers...', color: 'cyan' }).start()

    try {
      const peers = await getRoomMembersExcluding(state.roomId, state.userId!)

      if (peers.length === 0) {
        spinner.succeed('No other peers in this room')
        return
      }

      const data: string[][] = [
        [chalk.blue.bold('Peer ID'), chalk.blue.bold('Status')],
        ...peers.map((peerId: any) => [chalk.green(peerId.substring(0, 16) + '...'), chalk.cyan('✓ Online')]),
      ]

      spinner.stop()
      console.log(chalk.cyan.bold('\n👥 Connected Peers:'))
      console.log(table(data))
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch peers'))
      printError(`${error instanceof Error ? error.message : String(error)}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      return
    }
    printError(`Failed to list peers: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function handleTransferHost(): Promise<void> {
  try {
    if (!state.isConnected || !state.roomId) {
      printError('Not connected to any room')
      return
    }

    if (!state.isHost) {
      printError('Only the host can transfer host role')
      return
    }

    const spinner = ora({ text: 'Fetching users in room...', color: 'cyan' }).start()

    try {
      const clients = await getRoomMembersExcluding(state.roomId, state.userId!)

      if (clients.length === 0) {
        spinner.succeed('No other users in this room to transfer host role to')
        return
      }

      spinner.stop()

      const userMap = await getUserProfiles(clients)

      const answer = await inquirer.prompt([
        {
          type: 'list',
          name: 'userId',
          message: chalk.cyan('Select a user to transfer host role to:'),
          choices: [
            ...clients.map((userId: string) => ({
              name: `${userMap.get(userId) || userId.substring(0, 16)}... (${userId.substring(0, 8)})`,
              value: userId,
            })),
            { name: chalk.gray('← Back'), value: 'back' },
          ],
          prefix: chalk.magenta('?'),
        },
      ])

      if (answer.userId === 'back') {
        return
      }

      const confirmAnswer = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirm',
          message: chalk.yellow(`Are you sure you want to transfer host role to ${userMap.get(answer.userId) || answer.userId.substring(0, 8)}?`),
          default: false,
          prefix: chalk.magenta('?'),
        },
      ])

      if (!confirmAnswer.confirm) {
        printInfo('Host transfer cancelled')
        return
      }

      const transferSpinner = ora({ text: 'Transferring host role...', color: 'cyan' }).start()
      
      try {
        const success = await transferHost(state.roomId, state.userId!, answer.userId)
        if (success) {
          transferSpinner.succeed(chalk.green('Host role transferred successfully!'))
          state.isHost = false
          printInfo('You are no longer the host')
        } else {
          transferSpinner.fail(chalk.red('Failed to transfer host role'))
          printError('The transfer may have failed due to a race condition or the user may have left the room')
        }
      } catch (error) {
        transferSpinner.fail(chalk.red('Transfer failed'))
        printError(`${error instanceof Error ? error.message : String(error)}`)
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch users'))
      printError(`${error instanceof Error ? error.message : String(error)}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      return
    }
    printError(`Failed to transfer host role: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function handleConnectToPeers(): Promise<void> {
  try {
    if (!state.isConnected || !state.roomId) {
      printError('Not connected to any room')
      return
    }

    if (!state.isHost) {
      printError('Only the host can connect to peers')
      return
    }

    const spinner = ora({ text: 'Fetching users in room...', color: 'cyan' }).start()

    try {
      const users = await getRoomMembersExcluding(state.roomId, state.userId!)

      if (users.length === 0) {
        spinner.succeed('No other users in this room to connect to')
        return
      }

      spinner.stop()

      const userMap = await getUserProfiles(users)

      const answer = await inquirer.prompt([
        {
          type: 'list',
          name: 'userId',
          message: chalk.cyan('Select a user to connect to:'),
          choices: [
            ...users.map((userId: string) => ({
              name: `${userMap.get(userId) || userId.substring(0, 16)}... (${userId.substring(0, 8)})`,
              value: userId,
            })),
            { name: chalk.gray('← Back'), value: 'back' },
          ],
          prefix: chalk.magenta('?'),
        },
      ])

      if (answer.userId === 'back') {
        return
      }

      const connectSpinner = ora({ text: `Connecting to user...`, color: 'cyan' }).start()
      
      try {
        await connectToPeer(answer.userId, true)
        connectSpinner.succeed(chalk.green(`Connected to user ${answer.userId.substring(0, 8)}`))
        printSuccess('Connection established!')
      } catch (error) {
        connectSpinner.fail(chalk.red('Connection failed'))
        printError(`${error instanceof Error ? error.message : String(error)}`)
      }
    } catch (error) {
      spinner.fail(chalk.red('Failed to fetch users'))
      printError(`${error instanceof Error ? error.message : String(error)}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      return
    }
    printError(`Failed to connect to peers: ${error instanceof Error ? error.message : String(error)}`)
  }
}

async function handleDisconnectFromRoom(): Promise<void> {
  try {
    if (!state.roomId) {
      printError('Not connected to any room')
      return
    }

    const spinner = ora({ text: 'Disconnecting...', color: 'cyan' }).start()

    try {
      await disconnectFromRoom(state.roomId)

      state.roomId = null
      state.isConnected = false
      state.isHost = false
      state.role = null
      state.peers = []

      spinner.succeed(chalk.green('Disconnected from room'))
      printSuccess('You have left the room')
    } catch (error) {
      spinner.fail(chalk.red('Disconnect failed'))
      printError(`${error instanceof Error ? error.message : String(error)}`)
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('User force closed')) {
      return
    }
    printError(`Failed to disconnect: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// ============= MAIN LOOP =============

async function mainMenu(): Promise<void> {
  try {
    const answer = await inquirer.prompt([
      {
        type: 'list',
        name: 'action',
        message: chalk.cyan('What would you like to do?'),
        choices: [
          {
            name: chalk.cyan('1. Create Room'),
            value: 'create',
            disabled: state.isConnected ? chalk.gray('(Already connected)') : false,
          },
          {
            name: chalk.cyan('2. Connect to Room'),
            value: 'connect',
            disabled: state.isConnected ? chalk.gray('(Already connected)') : false,
          },
          {
            name: chalk.magenta('3. Send Message'),
            value: 'send',
            disabled: !state.isConnected ? chalk.gray('(Not connected)') : false,
          },
          {
            name: chalk.blue('4. View Status'),
            value: 'status',
          },
          {
            name: chalk.yellow('5. List Peers'),
            value: 'list',
            disabled: !state.isConnected ? chalk.gray('(Not connected)') : false,
          },
          {
            name: chalk.green('6. Connect to Peers'),
            value: 'connectPeers',
            disabled: !state.isConnected || !state.isHost ? chalk.gray(state.isConnected ? '(Host only)' : '(Not connected)') : false,
          },
          {
            name: chalk.cyan('7. Transfer Host Role'),
            value: 'transferHost',
            disabled: !state.isConnected || !state.isHost ? chalk.gray(state.isConnected ? '(Host only)' : '(Not connected)') : false,
          },
          {
            name: chalk.red('8. Leave Room'),
            value: 'leave',
            disabled: !state.isConnected ? chalk.gray('(Not connected)') : false,
          },
          {
            name: chalk.red.bold('9. Switch Account'),
            value: 'switch',
          },
          {
            name: chalk.yellow('10. Exit'),
            value: 'exit',
          },
        ],
        prefix: chalk.magenta('?'),
      },
    ])

    switch (answer.action) {
      case 'connect':
        await handleConnectToRoom()
        break
      case 'create':
        await handleCreateRoom()
        break
      case 'send':
        await handleSendMessage()
        break
      case 'status':
        printStatus()
        break
      case 'list':
        await handleListPeers()
        break
      case 'connectPeers':
        await handleConnectToPeers()
        break
      case 'transferHost':
        await handleTransferHost()
        break
      case 'leave':
        await handleDisconnectFromRoom()
        break
      case 'switch':
        await switchAccount()
        break
      case 'exit':
        console.log(chalk.cyan.bold('\nThank you for using P2P WebRTC CLI! Goodbye! 👋\n'))
        process.exit(0)
    }

    console.log('')
    await mainMenu()
  } catch (error) {
    printError(`An error occurred: ${error instanceof Error ? error.message : String(error)}`)
    console.log(chalk.gray('\nReturning to main menu...\n'))
    await mainMenu()
  }
}

// ============= STARTUP =============

async function main(): Promise<void> {
  try {
    await setupOnboarding()
    
    printHeader()
    printHelp()
    await initializeSession()
    printStatus()
    console.log('')
    await mainMenu()
  } catch (error) {
    printError(`Fatal error: ${error instanceof Error ? error.message : String(error)}`)
    process.exit(1)
  }
}

// Global error handlers
process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  const errorMsg = reason?.message || reason?.toString() || String(reason)
  if (errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('Failed to fetch')) {
    console.log(chalk.red.bold('\n⚠️  Network Error Detected:'))
    console.log(chalk.yellow(`   ${errorMsg}`))
    console.log(chalk.gray('   This may indicate a connection issue with Supabase.\n'))
  } else {
    console.log(chalk.red.bold('\n⚠️  Unhandled Error:'))
    console.log(chalk.yellow(`   ${errorMsg}\n`))
  }
})

process.on('uncaughtException', (error: Error) => {
  const errorMsg = error.message || error.toString()
  if (errorMsg.includes('fetch') || errorMsg.includes('network') || errorMsg.includes('Failed to fetch')) {
    console.log(chalk.red.bold('\n⚠️  Network Error Detected:'))
    console.log(chalk.yellow(`   ${errorMsg}`))
    console.log(chalk.gray('   This may indicate a connection issue with Supabase.\n'))
  } else {
    console.log(chalk.red.bold('\n⚠️  Uncaught Exception:'))
    console.log(chalk.yellow(`   ${errorMsg}\n`))
  }
})

process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n\nShutting down gracefully...\n'))
  if (state.roomId) {
    await handleDisconnectFromRoom()
  }
  process.exit(0)
})

main().catch((error) => {
  console.error(chalk.red('Fatal error:'), error)
  process.exit(1)
})

