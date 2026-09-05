import { CHAKRA_PETCH_700_WOFF2, IBM_PLEX_MONO_400_WOFF2 } from './loopback-page-fonts.constants.js';
import { FRONTEND_URL } from '../../config/constants.js';

export function signingKeyPage(action: string, provisioningUrl: string, error: string | null): string {
    const errorMarkup =
        error === null ? '' : `<div class="alert" role="alert"><span>!</span>${escapeHtml(error)}</div>`;
    return document(
        'Connect Project CPU MCP',
        `<main class="shell">
            <section class="panel" aria-labelledby="page-title">
                ${header('SECURE CHANNEL', '')}
                <div class="panel-body">
                    <p class="eyebrow">OAUTH COMPLETE</p>
                    <h1 id="page-title">Paste your signing key</h1>
                    <p class="lede">Copy the <code>pbxk1</code> value from the Paybox tab, then paste it below.</p>

                    <div class="key-entry">
                        ${errorMarkup}
                        <form method="post" action="${escapeHtml(action)}">
                            <label for="signing-key">Paybox signing key <span>*</span></label>
                            <input id="signing-key" name="key" type="password" autocomplete="off" placeholder="pbxk1.…" required autofocus>
                            <p class="help">The key stays on this machine. Never send it through chat or an MCP argument.</p>
                            <button class="button primary" type="submit">Finish connection <span aria-hidden="true">→</span></button>
                        </form>
                    </div>

                    <section class="fallback" aria-label="Paybox fallback">
                        <div>
                            <p class="fallback-label">Paybox tab missing?</p>
                            <p class="fallback-copy">Use this only if Paybox did not open automatically.</p>
                        </div>
                        <a class="fallback-link" href="${escapeHtml(provisioningUrl)}" target="_blank" rel="noreferrer">
                            Open Paybox again <span aria-hidden="true">↗</span>
                        </a>
                    </section>
                </div>
                <footer>127.0.0.1 <span>//</span> LOCAL ONLY <span>//</span> NO CACHE</footer>
            </section>
        </main>`,
    );
}

export function connectionCompletePage(): string {
    return document(
        'Project CPU signing key received',
        `<main class="shell">
            <section class="panel compact" aria-labelledby="page-title">
                ${header('KEY RECEIVED', 'success')}
                <div class="panel-body complete">
                    <p class="eyebrow">FINISHING CONNECTION</p>
                    <h1 id="page-title">Signing key received</h1>
                    <p class="lede">Project CPU is finishing your login automatically. You can close this tab and return to Project CPU.</p>
                    <section class="key-entry" aria-label="Live grid">
                        <p class="eyebrow">OPERATOR VIEW // LIVE GRID</p>
                        <p class="lede">Watch the grid in real time. Issue orders in chat. The UI observes. The agent acts.</p>
                        <a class="button primary" href="${escapeHtml(FRONTEND_URL)}" target="_blank" rel="noopener noreferrer">
                            Open the grid <span aria-hidden="true">↗</span>
                        </a>
                    </section>
                </div>
                <footer>127.0.0.1 <span>//</span> LOCAL ONLY <span>//</span> KEY RECEIVED</footer>
            </section>
        </main>`,
    );
}

export function connectionFailedPage(): string {
    return document(
        'Project CPU connection failed',
        `<main class="shell">
            <section class="panel compact" aria-labelledby="page-title">
                ${header('INTERRUPTED', 'failed')}
                <div class="panel-body complete">
                    <p class="eyebrow">AUTH SEQUENCE STOPPED</p>
                    <h1 id="page-title">Connection not completed</h1>
                    <p class="lede">Close this tab and run <code>cpu_authenticate</code> again.</p>
                </div>
                <footer>127.0.0.1 <span>//</span> LOCAL ONLY <span>//</span> STOPPED</footer>
            </section>
        </main>`,
    );
}

function document(title: string, body: string): string {
    return `<!doctype html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <style>
        @font-face {
            font-family: 'IBM Plex Mono';
            src: url(data:font/woff2;base64,${IBM_PLEX_MONO_400_WOFF2}) format('woff2');
            font-weight: 400;
            font-display: swap;
        }
        @font-face {
            font-family: 'Chakra Petch';
            src: url(data:font/woff2;base64,${CHAKRA_PETCH_700_WOFF2}) format('woff2');
            font-weight: 700;
            font-display: swap;
        }
        :root {
            color-scheme: dark;
            --bg: #000000;
            --bg2: #0a0a0a;
            --bg3: #101010;
            --fg: #e6e6df;
            --bright: #ffffff;
            --muted: #a0a098;
            --ghost: #6b6b64;
            --accent: #ccff00;
            --accent-hi: #ddff44;
            --accent-dim: #7a9900;
            --border: #1f1f1c;
            --red: #ff4455;
            --green: #00e08a;
            --font-sys: 'IBM Plex Mono', ui-monospace, monospace;
            --font-accent: 'Chakra Petch', sans-serif;
        }
        * { box-sizing: border-box; }
        body {
            min-height: 100vh;
            margin: 0;
            color: var(--fg);
            font-family: var(--font-sys);
            font-size: 15px;
            line-height: 1.5;
            background:
                linear-gradient(rgba(204,255,0,.035) 1px, transparent 1px),
                linear-gradient(90deg, rgba(204,255,0,.035) 1px, transparent 1px),
                radial-gradient(circle at 50% 0, rgba(204,255,0,.08), transparent 36rem),
                var(--bg);
            background-size: 32px 32px, 32px 32px, auto, auto;
        }
        a { color: inherit; text-decoration: none; }
        button, input { font: inherit; }
        .shell { display: grid; min-height: 100vh; place-items: center; padding: 32px 20px; }
        .panel {
            width: min(680px, 100%);
            background: var(--border);
            clip-path: polygon(
                12px 0, calc(100% - 12px) 0, 100% 12px, 100% calc(100% - 12px),
                calc(100% - 12px) 100%, 12px 100%, 0 calc(100% - 12px), 0 12px
            );
            padding: 1px;
        }
        .panel > * { background: var(--bg2); }
        .panel-head {
            display: flex;
            gap: 12px;
            align-items: center;
            padding: 10px 14px;
            color: var(--bright);
            font-size: 11px;
            letter-spacing: 1.6px;
            border-bottom: 1px solid var(--border);
        }
        .brand { display: flex; gap: 10px; align-items: center; }
        .brand-mark { display: block; width: 24px; height: 24px; }
        .brand-mark polygon { fill: var(--accent); }
        .brand-mark rect { fill: var(--bg2); }
        .brand-name { font-weight: 700; font-family: var(--font-accent); font-size: 16px; letter-spacing: 1.6px; text-transform: uppercase; }
        .header-context { color: var(--ghost); }
        .status { margin-left: auto; color: var(--muted); }
        .status.success { color: var(--green); }
        .status.failed { color: var(--red); }
        .panel-body { padding: 32px; }
        .eyebrow { margin: 0 0 8px; color: var(--accent); font-size: 11px; letter-spacing: 2px; }
        h1, h2 { font-family: var(--font-accent); text-transform: uppercase; }
        h1 { margin: 0; color: var(--bright); font-size: clamp(26px, 6vw, 42px); line-height: 1.06; letter-spacing: 1.6px; }
        h2 { margin: 0 0 4px; color: var(--bright); font-size: 15px; letter-spacing: 1.2px; }
        p { margin: 0; }
        .lede { max-width: 58ch; margin-top: 14px; color: var(--muted); }
        .key-entry {
            margin-top: 28px;
            padding: 20px;
            background: var(--bg3);
            border: 1px solid var(--border);
        }
        .button {
            display: flex;
            width: 100%;
            align-items: center;
            justify-content: space-between;
            margin-top: 16px;
            padding: 12px 16px;
            font-weight: 700;
            font-family: var(--font-accent);
            letter-spacing: 2px;
            text-transform: uppercase;
            border: 1px solid transparent;
            cursor: pointer;
        }
        .primary { color: #000; background: var(--accent); }
        .primary:hover { background: var(--accent-hi); }
        form { margin: 0; }
        label { display: block; margin-bottom: 6px; color: #c6c6bd; font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; }
        label span { color: var(--accent); }
        input {
            width: 100%;
            padding: 16px;
            color: var(--bright);
            background: var(--bg);
            border: 1px solid var(--border);
            outline: none;
        }
        input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(204,255,0,.08); }
        input::placeholder { color: var(--ghost); }
        .help { margin-top: 6px; color: var(--muted); font-size: 11px; }
        .fallback {
            display: flex;
            gap: 18px;
            align-items: center;
            justify-content: space-between;
            margin-top: 24px;
            padding-top: 20px;
            border-top: 1px solid var(--border);
        }
        .fallback-label { color: var(--fg); font-size: 12px; font-weight: 700; }
        .fallback-copy { margin-top: 2px; color: var(--ghost); font-size: 11px; }
        .fallback-link {
            flex: none;
            padding: 9px 11px;
            color: var(--muted);
            border: 1px solid var(--border);
            font-size: 10px;
            letter-spacing: 1px;
            text-transform: uppercase;
        }
        .fallback-link:hover { color: var(--accent); border-color: var(--accent-dim); }
        .alert {
            display: flex;
            gap: 10px;
            margin-top: 16px;
            padding: 10px 12px;
            color: var(--red);
            background: rgba(255,68,85,.06);
            border: 1px solid rgba(255,68,85,.3);
            font-size: 12px;
        }
        .alert span { font-weight: 700; }
        code { color: var(--bright); font-family: inherit; }
        footer { padding: 10px 14px; color: var(--ghost); font-size: 10px; letter-spacing: 1.6px; border-top: 1px solid var(--border); }
        footer span { color: var(--accent-dim); }
        .complete { padding-top: 52px; padding-bottom: 52px; }
        @media (max-width: 520px) {
            .panel-body { padding: 24px 18px; }
            .status { display: none; }
            .header-context { display: none; }
            .button { letter-spacing: 1.2px; }
            .key-entry { padding: 18px 14px; }
            .fallback { display: block; }
            .fallback-link { display: flex; justify-content: space-between; margin-top: 12px; }
        }
        @media (prefers-reduced-motion: no-preference) {
            .panel { animation: arrive .2s ease-out; }
            @keyframes arrive { from { opacity: 0; transform: translateY(8px); } }
        }
    </style>
</head>
<body>${body}</body>
</html>`;
}

function escapeHtml(value: string): string {
    return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
}

function header(status: string, statusClass: string): string {
    const classes = statusClass === '' ? 'status' : `status ${statusClass}`;
    return `<header class="panel-head">
        <span class="brand">
            <svg class="brand-mark" viewBox="8 8 84 84" aria-hidden="true">
                <polygon points="17.91,8 82.09,8 92,17.91 92,82.09 82.09,92 17.91,92 8,82.09 8,17.91"></polygon>
                <rect x="30.9" y="56.8" width="38.2" height="9.8"></rect>
            </svg>
            <span class="brand-name">Project CPU</span>
        </span>
        <span class="header-context">/ PAYBOX LINK</span>
        <span class="${classes}">${escapeHtml(status)}</span>
    </header>`;
}
