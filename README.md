# MoCS Discord Bot

This public guide covers how members and authorized staff use the bot in Discord. It does not contain private installation, deployment, or server-administration instructions.

## Getting started

Use the bot's slash commands in an official MoCS Discord server. The bot may also allow some commands in direct messages. Commands and options appear in Discord's `/` menu.

To link your Roblox account:

1. Run `/verify`.
2. Select **Verify Roblox** and complete the Roblox sign-in in your browser.
3. Confirm the Roblox account when prompted.

The bot links the confirmed Roblox account to your Discord account. If you have already linked an account, `/verify` lets you reverify or choose a different account. Some member commands require a linked Roblox account and MoCS group membership.

## Member commands

| Command | What it does |
| --- | --- |
| `/profile [username]` | Shows a Roblox profile, including account ID, account age, group ranks, and recent citizenship activity. If `username` is omitted, it uses your linked Roblox account when available. |
| `/check-ct username` | Checks citizenship-test information and eligibility for the Roblox username provided. |
| `/check-join username` | Checks candidacy eligibility for the Roblox username provided. |
| `/qp [username]` | Shows this week's quota points for you or the optional Roblox username. |
| `/verify` | Verifies and links your Roblox account, or starts reverification. |
| `/greet` | Greets you. |

Eligibility checks depend on current Roblox and other required records. If information cannot be verified because a lookup is unavailable, the bot asks you to try again; that response is not a confirmed eligibility decision.

## Activity logging

These commands submit activity records. Choose the requested log type and fill in the fields shown by Discord. Add either a proof link or a proof-file upload when appropriate.

| Command | Information requested |
| --- | --- |
| `/log-ct` | Citizenship-test activity, attendee, result, and related CT details. |
| `/log-patrol` | Patrol type, duration, description, and proof. |
| `/log-event` | Event type, description, attendee, and proof. |
| `/log-others` | Other activity type, description, number, and proof. |

Logging commands are restricted by MoCS rank. If your rank cannot be verified or you do not meet the command's requirement, ask an authorized staff member for help.

## Applications

Authorized staff can use `/candidate` to post the candidacy application button. Applicants follow the button, provide their Roblox username, and complete the verification steps.

## Authorized staff commands

These commands are restricted to users with the required authorization:

| Command | What it does |
| --- | --- |
| `/restart` | Restarts the bot. |
| `/update [status]` | Starts the configured bot/server update and shows animated, step-by-step progress in the original reply, or shows update status when `status` is `true`. |
| `/system-stats` | Shows bot host and process statistics. |
| `/cache stats` | Shows lookup cache statistics. |
| `/cache clear [name]` | Clears a selected lookup cache, or all caches if no name is selected. |

Only use `/restart` or `/update` when you are authorized and intend to perform the action. An update may include operating-system updates and can require a server reboot.

## Tips

- Start commands with `/` and select the MoCS bot command from Discord's command picker.
- Fill in the required options shown by Discord; optional options can be left blank.
- Data lookups can take a moment. The bot displays a loading message while it works.
- If an eligibility lookup reports that it could not verify information, retry later rather than treating it as a pass or fail.
- For access, account-linking, or command errors, contact MoCS staff. Do not send passwords, tokens, or private credentials in Discord.
