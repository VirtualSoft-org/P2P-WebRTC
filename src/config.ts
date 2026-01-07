import fs from 'fs'
import path from 'path'

export interface Config {
  supabaseUrl: string
  supabaseKey: string
  turnUrl?: string
  turnUser?: string
  turnPass?: string
}

export function readExistingConfig(): { [key: string]: string } {
  const envPath = path.join(process.cwd(), '.env')
  const existingEnv: { [key: string]: string } = {}
  
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf-8')
    const envLines = envContent.split('\n')
    for (const line of envLines) {
      if (line && !line.startsWith('#')) {
        const [key, ...valueParts] = line.split('=')
        if (key) existingEnv[key.trim()] = valueParts.join('=').trim()
      }
    }
  }
  
  return existingEnv
}

export function saveConfig(config: Config): void {
  const envPath = path.join(process.cwd(), '.env')
  
  const envContent = `# Supabase Configuration
SUPABASE_URL=${config.supabaseUrl}
SUPABASE_ANON_KEY=${config.supabaseKey}

# Optional: TURN Server Configuration for NAT traversal
${config.turnUrl ? `TURN_URL=${config.turnUrl}` : '# TURN_URL=turn:turn.example.com'}
${config.turnUser ? `TURN_USER=${config.turnUser}` : '# TURN_USER=username'}
${config.turnPass ? `TURN_PASS=${config.turnPass}` : '# TURN_PASS=password'}

# Debug mode
DEBUG=false
`

  fs.writeFileSync(envPath, envContent)
  
  // Update process.env immediately
  process.env.SUPABASE_URL = config.supabaseUrl
  process.env.SUPABASE_ANON_KEY = config.supabaseKey
}

