export const DISCORD_DM_MESSAGE_FIXTURE = Object.freeze({
  eventId: 'discord-event-dm-1',
  senderId: 'discord-user-100',
  channelId: 'discord-dm-channel-100',
  scope: 'dm' as const,
  type: 'message' as const,
  content: 'hello from a DM',
  attachments: Object.freeze([
    Object.freeze({
      id: 'attachment-dm-1',
      mediaType: 'image/png',
      size: 12_345,
      filename: 'proof.png',
    }),
  ]),
  observedAt: 100_000,
});

export const DISCORD_GUILD_MESSAGE_FIXTURE = Object.freeze({
  eventId: 'discord-event-guild-1',
  senderId: 'discord-user-200',
  channelId: 'discord-channel-200',
  scope: 'guild' as const,
  guildId: 'discord-guild-10',
  type: 'message' as const,
  content: 'hello from a guild channel',
  observedAt: 100_000,
});

export const DISCORD_GUILD_THREAD_REACTION_FIXTURE = Object.freeze({
  eventId: 'discord-event-thread-reaction-1',
  senderId: 'discord-user-300',
  channelId: 'discord-channel-300',
  scope: 'guild' as const,
  guildId: 'discord-guild-10',
  threadId: 'discord-thread-77',
  type: 'reaction-add' as const,
  reaction: Object.freeze({
    messageId: 'discord-message-55',
    emoji: '✅',
  }),
  observedAt: 100_000,
});

export const DISCORD_GUILD_OUTBOUND_FIXTURE = Object.freeze({
  scope: 'guild' as const,
  channelId: 'discord-channel-400',
  guildId: 'discord-guild-10',
  threadId: 'discord-thread-88',
  text: 'FuryPipe governed outbound message',
  idempotencyKey: ['discord', 'outbound', 'fixture', '1'].join('-'),
});
