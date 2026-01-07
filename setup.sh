#!/bin/bash
# Quick Start Guide for P2P WebRTC CLI

echo "╔════════════════════════════════════════════════════════════╗"
echo "║     P2P WebRTC CLI - Quick Start Setup                     ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "📝 Creating .env from template..."
    cp .env.example .env
    echo "✅ .env created! Please edit with your Supabase credentials:"
    echo "   - SUPABASE_URL"
    echo "   - SUPABASE_ANON_KEY"
    echo ""
else
    echo "✅ .env file found"
fi

echo "📦 Installing dependencies..."
npm install

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║                  Setup Complete! 🎉                       ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""
echo "Available commands:"
echo ""
echo "  🖥️  npm run cli              - Start the interactive CLI"
echo "  🌐 npm run start:signaling   - Start the WebSocket signaling server"
echo "  🏗️  npm run build            - Build TypeScript"
echo ""
echo "Quick start with CLI:"
echo "  1. Make sure your .env has valid Supabase credentials"
echo "  2. Run: npm run cli"
echo "  3. Follow the interactive prompts"
echo ""
echo "Or use browser demos:"
echo "  1. Terminal 1: npm run start:signaling"
echo "  2. Terminal 2 (optional): npm run cli"
echo "  3. Open server/host/host.html and server/client/client.html"
echo ""
