import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import React from 'react';

import { LegacyImportPromptView } from '../LegacyImportPrompt';

describe('LegacyImportPromptView', () => {
  it('asks about the events and offers both choices', async () => {
    const onAdd = jest.fn(async () => {});
    const onKeepOff = jest.fn(async () => {});
    render(<LegacyImportPromptView count={37} onAdd={onAdd} onKeepOff={onKeepOff} />);
    expect(screen.getByText(/There are 37 events saved on this phone/)).toBeTruthy();
    fireEvent.press(screen.getByRole('button', { name: 'Add to my account' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalled());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep them off my account' })).not.toBeDisabled());
    fireEvent.press(screen.getByRole('button', { name: 'Keep them off my account' }));
    await waitFor(() => expect(onKeepOff).toHaveBeenCalled());
  });

  it('uses the singular for one event', () => {
    render(<LegacyImportPromptView count={1} onAdd={async () => {}} onKeepOff={async () => {}} />);
    expect(screen.getByText(/There is 1 event saved on this phone/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Keep it off my account' })).toBeTruthy();
  });

  it("shows an error and re-enables the buttons when the action rejects", async () => {
    const onAdd = jest.fn()
      .mockRejectedValueOnce(new Error('network error'))
      .mockResolvedValueOnce(undefined);
    const onKeepOff = jest.fn(async () => {});
    render(<LegacyImportPromptView count={5} onAdd={onAdd} onKeepOff={onKeepOff} />);
    fireEvent.press(screen.getByRole('button', { name: 'Add to my account' }));
    await waitFor(() => expect(screen.getByText("Couldn't save your answer. Try again.")).toBeTruthy());
    // Both buttons must be re-enabled after the error
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep them off my account' })).not.toBeDisabled());
    // Add to my account also works again after the error
    fireEvent.press(screen.getByRole('button', { name: 'Add to my account' }));
    await waitFor(() => expect(onAdd).toHaveBeenCalledTimes(2));
    // Wait for the second Add to finish (busy clears) before pressing Keep
    await waitFor(() => expect(screen.getByRole('button', { name: 'Keep them off my account' })).not.toBeDisabled());
    fireEvent.press(screen.getByRole('button', { name: 'Keep them off my account' }));
    await waitFor(() => expect(onKeepOff).toHaveBeenCalled());
  });
});
