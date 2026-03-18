import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/preact';
import { ContactForm } from './ContactForm';
import type { CheckoutFormState } from '@/types/checkout';

function defaultForm(): CheckoutFormState {
  return {
    email: '',
    phone: '',
    firstName: '',
    lastName: '',
    street: '',
    city: '',
    postalCode: '',
    countryCode: 'NL',
    fulfillmentMethod: 'delivery',
    pickupLocationId: null,
    schedulingMode: 'asap',
    scheduledDate: null,
    selectedSlotId: null,
    selectedShippingRateId: null,
  };
}

describe('ContactForm', () => {
  let dispatch: (...args: unknown[]) => void;
  let onBlur: () => void;

  beforeEach(() => {
    cleanup();
    dispatch = vi.fn();
    onBlur = vi.fn();
  });

  it('renders all 4 fields with correct labels', () => {
    const { getByText } = render(
      <ContactForm
        lang="en"
        form={defaultForm()}
        dispatch={dispatch}
        onBlur={onBlur}
        errors={{}}
      />,
    );
    expect(getByText('Email')).toBeTruthy();
    expect(getByText('Phone number')).toBeTruthy();
    expect(getByText('First name')).toBeTruthy();
    expect(getByText('Last name')).toBeTruthy();
  });

  it('renders section heading', () => {
    const { getByText } = render(
      <ContactForm
        lang="en"
        form={defaultForm()}
        dispatch={dispatch}
        onBlur={onBlur}
        errors={{}}
      />,
    );
    expect(getByText('Contact information')).toBeTruthy();
  });

  it('dispatches SET_FIELD on input change', () => {
    const { container } = render(
      <ContactForm
        lang="en"
        form={defaultForm()}
        dispatch={dispatch}
        onBlur={onBlur}
        errors={{}}
      />,
    );
    const emailInput = container.querySelector('input[name="email"]')!;
    fireEvent.input(emailInput, { target: { value: 'test@example.com' } });
    expect(dispatch).toHaveBeenCalledWith({
      type: 'SET_FIELD',
      field: 'email',
      value: 'test@example.com',
    });
  });

  it('dispatches SET_FIELD for each field', () => {
    const { container } = render(
      <ContactForm
        lang="en"
        form={defaultForm()}
        dispatch={dispatch}
        onBlur={onBlur}
        errors={{}}
      />,
    );

    const fields = ['email', 'phone', 'firstName', 'lastName'] as const;
    for (const field of fields) {
      const input = container.querySelector(`input[name="${field}"]`)!;
      fireEvent.input(input, { target: { value: `val-${field}` } });
      expect(dispatch).toHaveBeenCalledWith({
        type: 'SET_FIELD',
        field,
        value: `val-${field}`,
      });
    }
  });

  it('shows error messages from errors prop', () => {
    const errors = {
      email: 'Email is required',
      firstName: 'First name is required',
    };
    const { getAllByRole, getByText } = render(
      <ContactForm
        lang="en"
        form={defaultForm()}
        dispatch={dispatch}
        onBlur={onBlur}
        errors={errors}
      />,
    );
    const alerts = getAllByRole('alert');
    expect(alerts).toHaveLength(2);
    expect(getByText('Email is required')).toBeTruthy();
    expect(getByText('First name is required')).toBeTruthy();
  });

  it('calls onBlur on field blur', () => {
    const { container } = render(
      <ContactForm
        lang="en"
        form={defaultForm()}
        dispatch={dispatch}
        onBlur={onBlur}
        errors={{}}
      />,
    );
    const phoneInput = container.querySelector('input[name="phone"]')!;
    fireEvent.blur(phoneInput);
    expect(onBlur).toHaveBeenCalledTimes(1);
  });

  it('renders correct input types', () => {
    const { container } = render(
      <ContactForm
        lang="en"
        form={defaultForm()}
        dispatch={dispatch}
        onBlur={onBlur}
        errors={{}}
      />,
    );
    expect(container.querySelector('input[name="email"]')!.getAttribute('type')).toBe('email');
    expect(container.querySelector('input[name="phone"]')!.getAttribute('type')).toBe('tel');
  });
});
