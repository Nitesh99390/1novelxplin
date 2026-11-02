// grammY bot: wires Telegram updates to the service layer.
import { Bot } from 'grammy';
import { autoRetry } from '@grammyjs/auto-retry';

export const ALLOWED_UPDATES = ['message', 'callback_query', 'my_chat_member', 'chat_member', 'chat_join_request', 'pre_checkout_query'];

export function createBot(config, makeService) {
  const bot = new Bot(config.botToken);
  bot.api.config.use(autoRetry({ maxRetryAttempts: 3, maxDelaySeconds: 30 }));
  const svc = makeService(bot.api);

  bot.catch((err) => console.error('[bot]', err.error?.description || err.error?.message || err.error));

  // Bot added / promoted / removed in a group or channel
  bot.on('my_chat_member', (ctx) => svc.onMyChatMember(ctx.myChatMember));

  // Members joining / leaving (needs chat_member in allowed_updates)
  bot.on('chat_member', (ctx) => svc.onChatMember(ctx.chatMember));
  bot.on('chat_join_request', (ctx) => svc.onJoinRequest(ctx.chatJoinRequest));

  // Payments in Telegram Stars
  bot.on('pre_checkout_query', async (ctx) => {
    const r = svc.onPreCheckout(ctx.preCheckoutQuery);
    await ctx.answerPreCheckoutQuery(r.ok, r.ok ? undefined : { error_message: r.error });
  });
  bot.on('message:successful_payment', (ctx) => svc.onSuccessfulPayment(ctx.from, ctx.message.successful_payment));

  // "/start setup" sent into a group by the startgroup deep link — the DM does the rest
  bot.chatType(['group', 'supergroup']).command('start', () => {});

  const pm = bot.chatType('private');
  pm.command('start', (ctx) => svc.onStart(ctx.from, ctx.match || ''));
  pm.command(['my', 'memberships'], (ctx) => svc.onStart(ctx.from, ''));
  pm.command('help', (ctx) => svc.onStart(ctx.from, ''));
  pm.command('paysupport', (ctx) => ctx.reply('For payment questions or refunds please contact the owner of the group / channel you bought. If something went wrong with the bot, reply here with your order details.'));

  pm.on('message:text', async (ctx) => {
    const r = svc.onText(ctx.from, ctx.message.text);
    if (r) await ctx.reply(r.text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: r.reply_markup });
    else await svc.onStart(ctx.from, '');
  });

  bot.on('callback_query:data', async (ctx) => {
    const r = await svc.onCallback(ctx.from, ctx.callbackQuery.data);
    if (r.text) {
      await ctx.editMessageText(r.text, { parse_mode: 'HTML', link_preview_options: { is_disabled: true }, reply_markup: r.reply_markup })
        .catch((e) => { if (!/not modified/i.test(e.description || '')) throw e; });
    }
    await ctx.answerCallbackQuery(r.toast ? { text: r.toast, show_alert: !!r.alert } : undefined).catch(() => {});
  });

  return { bot, svc };
}

/** Commands, menu button, descriptions and default admin rights. */
export async function configureBot(bot, config) {
  const api = bot.api;
  const safe = (p) => p.catch((e) => console.warn('[setup]', e.description || e.message));
  await safe(api.setMyCommands([
    { command: 'start', description: 'Open the main menu' },
    { command: 'my', description: 'My memberships' },
    { command: 'paysupport', description: 'Payment support' },
  ]));
  if (/^https:\/\//.test(config.publicUrl)) {
    await safe(api.setChatMenuButton({ menu_button: { type: 'web_app', text: '⭐ Open', web_app: { url: `${config.publicUrl}/` } } }));
  }
  await safe(api.setMyShortDescription('Sell access to your paid groups & channels for Telegram Stars ⭐'));
  await safe(api.setMyDescription('Add me as admin to your group or channel → set a price in Telegram Stars and the number of days → members pay in the Mini App, get a one-time invite link, and I remove them automatically when their time is over.'));
  const rights = { is_anonymous: false, can_manage_chat: true, can_delete_messages: true, can_manage_video_chats: false, can_restrict_members: true, can_promote_members: false, can_change_info: false, can_invite_users: true, can_post_stories: false, can_edit_stories: false, can_delete_stories: false };
  await safe(api.setMyDefaultAdministratorRights({ rights }));
  await safe(api.setMyDefaultAdministratorRights({ rights: { ...rights, can_post_messages: true, can_edit_messages: false }, for_channels: true }));
}
