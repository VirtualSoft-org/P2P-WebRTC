import fs from 'fs'
import path from 'path'

const DEBUG = process.env.DEBUG === 'true'
const LOG_FILE = process.env.LOG_FILE || path.join(process.cwd(), 'pulse.log')

let logFileStream: fs.WriteStream | null = null
const initLogFile = () => {
  if (logFileStream) return
  try {
    logFileStream = fs.createWriteStream(LOG_FILE, { flags: 'a' })
    logFileStream.write(`\n[${new Date().toISOString()}] === New Session ===\n`)
  } catch (e) {
    console.error('Failed to initialize log file:', e)
  }
}

const writeLog = (prefix: string, module: string, msg: string, data?: any) => {
  const timestamp = new Date().toISOString().split('T')[1].substring(0, 8)
  const line = data !== undefined 
    ? `[${timestamp}] ${prefix}[${module}] ${msg} ${JSON.stringify(data)}`
    : `[${timestamp}] ${prefix}[${module}] ${msg}`
  
  if (!logFileStream) initLogFile()
  if (logFileStream) {
    logFileStream.write(line + '\n')
  }
}

export const log = {
  info: (module: string, msg: string, data?: any) => {
    if (data !== undefined) {
      console.log(`[${module}] ${msg}`, data)
    } else {
      console.log(`[${module}] ${msg}`)
    }
    writeLog('', module, msg, data)
  },

  warn: (module: string, msg: string, data?: any) => {
    if (data !== undefined) {
      console.warn(`⚠️  [${module}] ${msg}`, data)
    } else {
      console.warn(`⚠️  [${module}] ${msg}`)
    }
    writeLog('⚠️  ', module, msg, data)
  },

  error: (module: string, msg: string, data?: any) => {
    if (data !== undefined) {
      console.error(`❌ [${module}] ${msg}`, data)
    } else {
      console.error(`❌ [${module}] ${msg}`)
    }
    writeLog('❌ ', module, msg, data)
  },

  debug: (module: string, msg: string, data?: any) => {
    if (!DEBUG) return
    if (data !== undefined) {
      console.log(`🔍 [${module}] ${msg}`, data)
    } else {
      console.log(`🔍 [${module}] ${msg}`)
    }
    writeLog('🔍 ', module, msg, data)
  },

  success: (module: string, msg: string, data?: any) => {
    if (data !== undefined) {
      console.log(`✅ [${module}] ${msg}`, data)
    } else {
      console.log(`✅ [${module}] ${msg}`)
    }
    writeLog('✅ ', module, msg, data)
  },
}
