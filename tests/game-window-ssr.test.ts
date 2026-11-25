import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { GameWindow } from '@/components/gameui/GameWindow';

describe('a game window opened from a link renders on the server', () => {
  it('renders nothing on the server instead of failing with „document is not defined“ (/game/contracts?load=…)', () => {
    expect(typeof document).toBe('undefined');
    const props = { title: 'Товар', onClose: () => {} } as Parameters<typeof GameWindow>[0];
    expect(renderToString(createElement(GameWindow, props, 'x'))).toBe('');
  });
});
