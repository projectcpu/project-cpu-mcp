export function browserLaunchCommand(url: string, platform: NodeJS.Platform): readonly [string, ReadonlyArray<string>] {
    if (platform === 'darwin') {
        return ['open', [url]];
    }
    if (platform === 'win32') {
        return ['rundll32', ['url.dll,FileProtocolHandler', url]];
    }
    return ['xdg-open', [url]];
}
