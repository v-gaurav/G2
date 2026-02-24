# Intent: src/messaging/whatsapp/WhatsAppChannel.ts modifications

## What changed
Added voice message transcription support. When a WhatsApp voice note (PTT audio) arrives, it is downloaded and transcribed via OpenAI Whisper before being stored as message content.

## Key sections

### Imports (top of file)
- Added: `isVoiceMessage`, `transcribeAudioMessage` from `./Transcription.js`

### messages.upsert handler (inside connectInternal)
- Added: `let finalContent = content` variable to allow voice transcription to override text content
- Added: `isVoiceMessage(msg)` check after content extraction
- Added: try/catch block calling `transcribeAudioMessage(msg, this.sock)`
  - Success: `finalContent = '[Voice: <transcript>]'`
  - Null result: `finalContent = '[Voice Message - transcription unavailable]'`
  - Error: `finalContent = '[Voice Message - transcription failed]'`
- Changed: `this.opts.onMessage()` call uses `finalContent` instead of `content`

## Invariants (must-keep)
- All existing message handling (conversation, extendedTextMessage, imageMessage, videoMessage) unchanged
- Connection lifecycle (connect, reconnect, disconnect) unchanged
- LID translation logic unchanged
- OutgoingMessageQueue usage unchanged
- WhatsAppMetadataSync / syncMetadata unchanged
- reconnectWithBackoff unchanged
- sendMessage prefix logic unchanged
- setTyping, ownsJid, isConnected -- all unchanged
