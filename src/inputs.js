import { platform as hostPlatform, arch as hostArch } from 'node:os';
import metadata from '../package.json' with { type: 'json' };

export const defaultVersion = metadata.version;

export function versionInput(value = '') {
  const input = value.trim() || defaultVersion;
  if (input === 'latest') return input;
  const version = input.replace(/^v/, '');
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) || version.length > 50) {
    throw new Error('version must be an exact stable version, such as 0.4.1, or latest');
  }
  return version;
}

export function platformInput(platform = hostPlatform(), arch = hostArch(), glibc) {
  if (platform === 'linux' && arch === 'x64') {
    glibc ??= process.report.getReport().header.glibcVersionRuntime;
    const [major, minor] = String(glibc).split('.').map(Number);
    if (!Number.isInteger(major) || !Number.isInteger(minor) || !(major > 2 || (major === 2 && minor >= 39))) {
      throw new Error('The Linux rb binary requires glibc 2.39 or newer; musl is unsupported');
    }
    return { asset: 'rb-linux', executable: 'rb', tool: 'rb-linux', arch };
  }
  if (platform === 'darwin' && arch === 'arm64') {
    return { asset: 'rb-macos', executable: 'rb', tool: 'rb-macos', arch };
  }
  if (platform === 'win32' && arch === 'x64') {
    return { asset: 'rb-windows.exe', executable: 'rb.exe', tool: 'rb-windows', arch };
  }
  throw new Error(`Unsupported platform ${platform}/${arch}; rb supports Linux x64, macOS arm64 and Windows x64`);
}
