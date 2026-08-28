export function signingKeyPage(action: string, provisioningUrl: string, error: string | null): string {
    const errorMarkup =
        error === null ? '' : `<div class="alert" role="alert"><span>!</span>${escapeHtml(error)}</div>`;
    return document(
        'Connect Project CPU MCP',
        `<main class="shell">
            <section class="panel" aria-labelledby="page-title">
                <header class="panel-head">
                    <span class="signal" aria-hidden="true"></span>
                    <span>PROJECT CPU // PAYBOX LINK</span>
                    <span class="status">SECURE CHANNEL</span>
                </header>
                <div class="panel-body">
                    <p class="eyebrow">AUTH SEQUENCE 02</p>
                    <h1 id="page-title">Connect your signing key</h1>
                    <p class="lede">OAuth is complete. Finish the one-time local link so Project CPU can use your autonomous Paybox wallet.</p>

                    <section class="step">
                        <div class="step-index">01</div>
                        <div class="step-copy">
                            <h2>Create the key in Paybox</h2>
                            <p>Paybox should open in a new tab. If it did not, continue with the button below.</p>
                        </div>
                    </section>
                    <a class="button primary" href="${escapeHtml(provisioningUrl)}" target="_blank" rel="noreferrer">
                        Connect Project CPU MCP <span aria-hidden="true">↗</span>
                    </a>

                    <div class="divider"><span>THEN RETURN HERE</span></div>

                    <section class="step">
                        <div class="step-index">02</div>
                        <div class="step-copy">
                            <h2>Paste the key locally</h2>
                            <p>Copy the <code>pbxk1</code> value Paybox shows and submit it below.</p>
                        </div>
                    </section>
                    ${errorMarkup}
                    <form method="post" action="${escapeHtml(action)}">
                        <label for="signing-key">Paste the pbxk1 signing key <span>*</span></label>
                        <input id="signing-key" name="key" type="password" autocomplete="off" placeholder="pbxk1.…" required autofocus>
                        <p class="help">The key stays on this machine. Never send it through chat or an MCP argument.</p>
                        <button class="button secondary" type="submit">Finish connection <span aria-hidden="true">→</span></button>
                    </form>
                </div>
                <footer>127.0.0.1 <span>//</span> LOCAL ONLY <span>//</span> NO CACHE</footer>
            </section>
        </main>`,
    );
}

export function connectionCompletePage(): string {
    return document(
        'Project CPU connected',
        `<main class="shell">
            <section class="panel compact" aria-labelledby="page-title">
                <header class="panel-head">
                    <span class="signal" aria-hidden="true"></span>
                    <span>PROJECT CPU // PAYBOX LINK</span>
                    <span class="status success">CONNECTED</span>
                </header>
                <div class="panel-body complete">
                    <p class="eyebrow">AUTH SEQUENCE COMPLETE</p>
                    <h1 id="page-title">Connection established</h1>
                    <p class="lede">Your Paybox signing key is stored locally. You can close this tab and return to Project CPU.</p>
                </div>
                <footer>127.0.0.1 <span>//</span> LOCAL ONLY <span>//</span> READY</footer>
            </section>
        </main>`,
    );
}

export function connectionFailedPage(): string {
    return document(
        'Project CPU connection failed',
        `<main class="shell">
            <section class="panel compact" aria-labelledby="page-title">
                <header class="panel-head">
                    <span class="signal danger" aria-hidden="true"></span>
                    <span>PROJECT CPU // PAYBOX LINK</span>
                    <span class="status failed">INTERRUPTED</span>
                </header>
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
        }
        * { box-sizing: border-box; }
        body {
            min-height: 100vh;
            margin: 0;
            color: var(--fg);
            font-family: 'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
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
            gap: 10px;
            align-items: center;
            padding: 10px 14px;
            color: var(--bright);
            font-size: 11px;
            letter-spacing: 1.6px;
            border-bottom: 1px solid var(--border);
        }
        .signal { width: 8px; height: 8px; background: var(--accent); }
        .signal.danger { background: var(--red); }
        .status { margin-left: auto; color: var(--accent); }
        .status.success { color: var(--green); }
        .status.failed { color: var(--red); }
        .panel-body { padding: 32px; }
        .eyebrow { margin: 0 0 8px; color: var(--accent); font-size: 11px; letter-spacing: 2px; }
        h1, h2 { font-family: 'Chakra Petch', 'Arial Narrow', sans-serif; text-transform: uppercase; }
        h1 { margin: 0; color: var(--bright); font-size: clamp(26px, 6vw, 42px); line-height: 1.06; letter-spacing: 1.6px; }
        h2 { margin: 0 0 4px; color: var(--bright); font-size: 15px; letter-spacing: 1.2px; }
        p { margin: 0; }
        .lede { max-width: 58ch; margin-top: 14px; color: var(--muted); }
        .step { display: grid; grid-template-columns: 34px 1fr; gap: 12px; margin-top: 28px; }
        .step-index { color: var(--accent); font-size: 11px; letter-spacing: 1.2px; border-top: 1px solid var(--accent-dim); padding-top: 3px; }
        .step-copy p { color: var(--muted); font-size: 13px; }
        .button {
            display: flex;
            width: 100%;
            align-items: center;
            justify-content: space-between;
            margin-top: 16px;
            padding: 16px;
            font-weight: 700;
            font-family: 'Chakra Petch', 'Arial Narrow', sans-serif;
            letter-spacing: 2px;
            text-transform: uppercase;
            border: 1px solid transparent;
            cursor: pointer;
        }
        .primary { color: #000; background: var(--accent); }
        .primary:hover { background: var(--accent-hi); }
        .secondary { color: var(--bright); background: transparent; border-color: var(--border); }
        .secondary:hover { color: var(--accent); border-color: var(--accent-dim); }
        .divider { display: flex; gap: 12px; align-items: center; margin: 30px 0 0; color: var(--ghost); font-size: 10px; letter-spacing: 1.6px; }
        .divider::before, .divider::after { content: ''; flex: 1; border-top: 1px solid var(--border); }
        form { margin-top: 16px; }
        label { display: block; margin-bottom: 6px; color: #c6c6bd; font-size: 11px; letter-spacing: 1.2px; text-transform: uppercase; }
        label span { color: var(--accent); }
        input {
            width: 100%;
            padding: 13px 14px;
            color: var(--bright);
            background: var(--bg);
            border: 1px solid var(--border);
            outline: none;
        }
        input:focus { border-color: var(--accent); }
        input::placeholder { color: var(--ghost); }
        .help { margin-top: 6px; color: var(--muted); font-size: 11px; }
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
            .button { letter-spacing: 1.2px; }
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
