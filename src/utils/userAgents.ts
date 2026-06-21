import UserAgent from 'user-agents';

export function getRandomUserAgent(): string {
  return new UserAgent().toString();
}

export const DESKTOP_VIEWPORT = {
  width: 1440,
  height: 900,
};
