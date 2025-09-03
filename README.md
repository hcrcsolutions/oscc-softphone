# OSCC Softphone

A modern Open Source Call Center Softphone built with Next.js and SIP.js, designed for seamless integration with FreeSWITCH.

## Features

- 🎯 **Modern Web Interface** - Built with Next.js 15.5.2 and TypeScript
- 📞 **SIP.js Integration** - Full SIP calling capabilities with WebSocket transport
- 🎨 **Beautiful UI** - Responsive design with DaisyUI components and dark/light theme support
- ⚙️ **FreeSWITCH Ready** - Pre-configured for FreeSWITCH WebSocket connections
- 🔄 **Real-time Status** - Live call states and registration status
- 📱 **Mobile-Friendly** - Circular keypad buttons optimized for touch interfaces
- 📊 **Call History** - Track incoming and outgoing calls
- 🔧 **Easy Configuration** - Simple setup interface for SIP credentials and audio settings

## Quick Start

### Prerequisites

- Node.js 18+ 
- FreeSWITCH server with WebSocket support
- Modern web browser with microphone permissions

### Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/oscc-softphone.git
cd oscc-softphone
```

2. Install dependencies:
```bash
npm install
```

3. Start the development server:
```bash
npm run dev
```

4. Open [http://localhost:3001](http://localhost:3001) in your browser

## Configuration

### FreeSWITCH Setup

The softphone is pre-configured to connect to FreeSWITCH with these default settings:

- **Server**: `10.254.18.165`
- **WebSocket Port**: `5066`
- **Username**: `1002`
- **Password**: `1234`
- **Domain**: `10.254.18.165`

### Customizing Settings

1. Navigate to the **Setup** tab in the application
2. Update SIP server settings as needed
3. Configure audio devices and volume levels
4. Test audio functionality
5. Save configuration

The settings are automatically saved to localStorage for persistence.

## Architecture

```
src/
├── components/           # React components
│   ├── AppWrapper.tsx   # Main app container with state management
│   ├── Header.tsx       # Navigation header with theme switcher
│   ├── Sidebar.tsx      # Collapsible navigation sidebar
│   ├── Phone.tsx        # Main phone interface with dialer
│   └── Setup.tsx        # Configuration interface
├── services/
│   └── sipService.ts    # SIP.js integration service
└── app/                 # Next.js app router files
```

## Technology Stack

- **Frontend**: Next.js 15.5.2, React 19, TypeScript
- **Styling**: Tailwind CSS, DaisyUI 5.1.6
- **SIP Protocol**: SIP.js 0.21.2
- **Icons**: Tabler Icons via react-icons
- **Build Tool**: Turbopack

## SIP.js Integration

The application uses SIP.js with WebSocket transport to communicate with FreeSWITCH:

- **WebSocket Connection**: `ws://server:5066`
- **Registration**: Automatic SIP registration with configurable credentials
- **Call Management**: Make, answer, and hang up calls
- **Real-time Events**: Live call state updates and registration status

## Browser Compatibility

- Chrome/Chromium 80+
- Firefox 75+
- Safari 14+
- Edge 80+

**Note**: Microphone permissions are required for audio functionality.

## Development

### Available Scripts

- `npm run dev` - Start development server with Turbopack
- `npm run build` - Build for production
- `npm run start` - Start production server
- `npm run lint` - Run ESLint

### Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## License

This project is open source and available under the [MIT License](LICENSE).

## Support

For support and questions:

- Open an issue on GitHub
- Check the FreeSWITCH documentation for server-side configuration
- Review SIP.js documentation for advanced SIP features

---

Built with ❤️ using Claude Code