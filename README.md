# P2P-WebRTC

A peer-to-peer communication platform built with WebRTC and TypeScript, enabling secure, decentralized messaging and collaboration through room-based architecture with end-to-end encryption.

## Features

- **Peer-to-Peer Communication**: Direct P2P connections using WebRTC for low-latency communication
- **Room-Based Architecture**: Create and join rooms for organized group communication
- **End-to-End Encryption**: Client-side encryption/decryption for secure data transfer
- **User Authentication**: Supabase-powered authentication and user management
- **Presence Tracking**: Real-time presence information for users in rooms
- **CLI Support**: Command-line interface for easy room and user management
- **Signaling Server**: Custom signaling server for WebRTC connection establishment

## Technology Stack

- **Frontend**: TypeScript, HTML5, CSS3
- **Backend**: Node.js, TypeScript
- **Real-time Communication**: WebRTC, Custom Signaling Server
- **Authentication**: Supabase
- **Encryption**: Client-side crypto utilities with key derivation functions
- **Database**: PostgreSQL (via Supabase)

## Database Schema

### Profiles Table
Stores user profile information.

```sql
create table profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  username text unique not null,
  created_at timestamp with time zone default now()
);
```

**Fields:**
- `id`: User ID (references Supabase auth users, primary key)
- `username`: Unique username
- `created_at`: Account creation timestamp

### Rooms Table
Stores room information and configuration.

```sql
create table rooms (
  id uuid default gen_random_uuid() primary key,
  room_name text not null,
  password_hash text,
  owner uuid references auth.users(id),
  created_at timestamp with time zone default now()
);
```

**Fields:**
- `id`: Unique room identifier
- `room_name`: Display name of the room
- `password_hash`: Optional hashed password for private rooms
- `owner`: User ID of the room creator
- `created_at`: Room creation timestamp

### Room Members Table
Tracks membership and join history for rooms.

```sql
create table room_members (
  id uuid default gen_random_uuid() primary key,
  room_id uuid not null references rooms(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamp with time zone default now(),
  unique(room_id, user_id)
);
```

**Fields:**
- `id`: Unique member record identifier
- `room_id`: Reference to the room
- `user_id`: Reference to the user
- `joined_at`: Timestamp when user joined the room
- Composite unique constraint prevents duplicate memberships

## Installation

### Prerequisites

- Node.js 16+ or modern runtime
- npm or yarn package manager
- Supabase account and project
- PostgreSQL database (provided by Supabase)

### Setup

1. **Clone the repository**
   ```bash
   git clone https://github.com/VirtualSoft-org/P2P-WebRTC
   cd P2P-WebRTC
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure environment**
   - Set up Supabase credentials
   - Configure the signaling server connection details
   - Set up encryption keys and KDF parameters

4. **Run the CLI**
   ```bash
   npm run cli
   ```

## Project Structure

```
├── server/                      #Beta
│   ├── signaling-server.ts      # Main signaling server
│   ├── client/                   # Client-side web interface
│   │   ├── client.ts
│   │   ├── client.html
│   │   └── client.css
│   └── host/                     # Host-side web interface
│       ├── host.ts
│       ├── host.html
│       └── host.css
├── src/
│   ├── auth.ts                   # Authentication logic
│   ├── cli.ts                    # TUI (Run this via terminal)
│   ├── config.ts                 # Configuration management
│   ├── hostElection.ts           # Host election algorithm
│   ├── joinRoom.ts               # Room joining logic
│   ├── logger.ts                 # Logging utilities
│   ├── presence.ts               # User presence tracking
│   ├── signaling.ts              # Signaling protocol
│   ├── supabase.ts               # Supabase integration
│   ├── user.ts                   # User management
│   ├── webrtc.ts                 # WebRTC utilities
│   └── crypto/                   # Encryption utilities
│       ├── encrypt.ts
│       ├── decrypt.ts
│       ├── kdf.ts
│       ├── index.ts
│       └── README.md
├── tsconfig.json
├── package.json
└── README.md
```


## Security

- **End-to-End Encryption**: All messages are encrypted on the client before transmission
- **Key Derivation**: Secure KDF implementation for key generation
- **Cascade Deletion**: Database constraints ensure data integrity on user/room deletion

## Architecture

### WebRTC Peer Connections
- Direct P2P connections between peers for optimal performance
- Signaling server facilitates initial connection setup only
- Once connected, all data flows directly between peers

### Host Election
- Dynamic host election for room management
- Hosts maintain room state and coordinate disconnections
- Automatic failover on host disconnection

### Presence Tracking
- Real-time presence updates for connected users
- Integration with signaling server for availability info

## Contributing

Contributions are welcome! Please ensure:
- Code is written in TypeScript
- Changes follow the existing code structure
- Database schema changes are documented
- Security implications are considered

## License

This project is licensed under the **GNU General Public License v3 (GPL-3.0)**.

You are free to:
- Use, modify, and distribute this software
- Study how it works

Under the condition that:
- Any derivative works are also licensed under GPL-3.0
- Source code is made available to recipients
- Changes must be documented

For more details, see the [LICENSE](LICENSE) file.

## Support

For issues, questions, or suggestions, please open an issue on the repository.
