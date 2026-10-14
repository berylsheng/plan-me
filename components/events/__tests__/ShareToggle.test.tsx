import { fireEvent, render, screen } from '@testing-library/react-native';
import React from 'react';

import { ShareToggle } from '../ShareToggle';

describe('ShareToggle', () => {
  it('shows both choices, with the current one selected', () => {
    render(<ShareToggle shared={false} onChange={jest.fn()} />);
    expect(screen.getByText('Who can see this')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Only me' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Family' })).not.toBeChecked();
  });

  it('switches when the other choice is tapped', () => {
    const onChange = jest.fn();
    const { rerender } = render(<ShareToggle shared={false} onChange={onChange} />);
    fireEvent.press(screen.getByRole('radio', { name: 'Family' }));
    expect(onChange).toHaveBeenCalledWith(true);
    rerender(<ShareToggle shared onChange={onChange} />);
    expect(screen.getByRole('radio', { name: 'Family' })).toBeChecked();
    fireEvent.press(screen.getByRole('radio', { name: 'Only me' }));
    expect(onChange).toHaveBeenLastCalledWith(false);
  });

  it('leaves out the heading in the compact form', () => {
    render(<ShareToggle shared={false} onChange={jest.fn()} compact />);
    expect(screen.queryByText('Who can see this')).toBeNull();
    expect(screen.getByText('Only me')).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Only me' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Family' })).toBeTruthy();
  });

  it('does nothing when locked', () => {
    const onChange = jest.fn();
    render(<ShareToggle shared onChange={onChange} disabled />);
    fireEvent.press(screen.getByRole('radio', { name: 'Only me' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('radio', { name: 'Only me' })).toBeDisabled();
  });
});
