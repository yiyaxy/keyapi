import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MarkdownContent } from './MarkdownContent';

describe('MarkdownContent', () => {
  it('renders markdown blocks in assistant messages', () => {
    render(<MarkdownContent content={'**Important**\n\n- first\n- second'} />);

    expect(screen.getByText('Important').tagName).toBe('STRONG');
    expect(screen.getByText('first').closest('ul')).toBeInTheDocument();
  });

  it('does not render raw html returned by a model', () => {
    render(<MarkdownContent content={'<img src=x onerror=alert(1)>'} />);

    expect(document.querySelector('img')).not.toBeInTheDocument();
    expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  });

  it('strips unsafe markdown link targets', () => {
    render(<MarkdownContent content={'[bad](javascript:alert(1))'} />);

    const anchor = document.querySelector('a');
    expect(anchor).toHaveTextContent('bad');
    expect(anchor).not.toHaveAttribute('href');
  });
});
