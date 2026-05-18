"use client";

let sdkPromise: Promise<any> | null = null;

export function loadMercadoPagoSdk() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("MercadoPago SDK only in browser"));
  }

  const w = window as any;
  if (w?.MercadoPago) return Promise.resolve(w.MercadoPago);
  if (sdkPromise) return sdkPromise;

  sdkPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector(
      'script[src="https://sdk.mercadopago.com/js/v2"]',
    ) as HTMLScriptElement | null;

    const done = () => {
      const MercadoPago = (window as any)?.MercadoPago;
      if (MercadoPago) resolve(MercadoPago);
      else reject(new Error("MercadoPago SDK not available"));
    };

    const fail = () => reject(new Error("MercadoPago SDK load failed"));

    if (existing) {
      if ((existing as any).dataset?.loaded === "1") done();
      else {
        existing.addEventListener("load", done, { once: true });
        existing.addEventListener("error", fail, { once: true });
      }
    } else {
      const script = document.createElement("script");
      script.src = "https://sdk.mercadopago.com/js/v2";
      script.async = true;
      (script as any).dataset.loaded = "0";
      script.addEventListener(
        "load",
        () => {
          (script as any).dataset.loaded = "1";
          done();
        },
        { once: true },
      );
      script.addEventListener("error", fail, { once: true });
      document.head.appendChild(script);
    }

    window.setTimeout(() => {
      const MercadoPago = (window as any)?.MercadoPago;
      if (MercadoPago) resolve(MercadoPago);
      else reject(new Error("MercadoPago SDK timeout"));
    }, 12000);
  });

  sdkPromise = sdkPromise.catch((e) => {
    sdkPromise = null;
    throw e;
  });

  return sdkPromise;
}

