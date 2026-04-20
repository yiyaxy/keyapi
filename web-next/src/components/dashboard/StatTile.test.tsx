import { render, screen } from '@testing-library/react';
import { describe, expect, test } from 'vitest';

import { StatTile } from './StatTile';

describe('StatTile', () => {
  test('renders label and value', () => {
    render(<StatTile label='Requests' value='12,347' />);
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('12,347')).toBeInTheDocument();
  });

  test('dash when value undefined', () => {
    render(<StatTile label='Requests' value={undefined} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
