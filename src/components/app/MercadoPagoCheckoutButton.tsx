"use client";

export function MercadoPagoCheckoutButton(props: {
  plan: "basico" | "pro" | "vitalicio";
  disabled?: boolean;
  className: string;
  children: React.ReactNode;
}) {
  if (props.disabled) {
    return (
      <button type="button" disabled className={props.className}>
        {props.children}
      </button>
    );
  }

  return (
    <a
      href={`/api/billing/mercadopago/checkout?plan=${encodeURIComponent(props.plan)}`}
      target="_blank"
      rel="noreferrer"
      className={props.className}
    >
      {props.children}
    </a>
  );
}
