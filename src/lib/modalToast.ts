"use client";

export type ModalToastVariant = "success" | "error" | "warning" | "info" | "confirm";

export type ModalToastOptions = {
  variant: ModalToastVariant;
  title?: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  id?: string;
};

type ModalToastInternal = Required<Pick<ModalToastOptions, "id" | "variant" | "message">> &
  Omit<ModalToastOptions, "id" | "variant" | "message">;

const confirmResolvers = new Map<string, (v: boolean) => void>();

function randomId() {
  return `${Date.now().toString(16)}-${Math.random().toString(16).slice(2)}`;
}

function emit(detail: ModalToastInternal) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("autobot:modal-toast", { detail }));
}

export const modalToast = {
  open(options: ModalToastOptions) {
    const id = options.id ?? randomId();
    emit({ ...options, id });
    return id;
  },
  success(message: string, title = "Sucesso") {
    return modalToast.open({ variant: "success", title, message });
  },
  error(message: string, title = "Atenção") {
    return modalToast.open({ variant: "error", title, message });
  },
  warning(message: string, title = "Atenção") {
    return modalToast.open({ variant: "warning", title, message });
  },
  info(message: string, title = "Aviso") {
    return modalToast.open({ variant: "info", title, message });
  },
  confirm(message: string, opts?: { title?: string; confirmText?: string; cancelText?: string }) {
    const id = randomId();
    return new Promise<boolean>((resolve) => {
      confirmResolvers.set(id, resolve);
      emit({
        id,
        variant: "confirm",
        title: opts?.title ?? "Confirmar",
        message,
        confirmText: opts?.confirmText ?? "Confirmar",
        cancelText: opts?.cancelText ?? "Cancelar",
      });
    });
  },
};

export function resolveModalConfirm(id: string, value: boolean) {
  const resolve = confirmResolvers.get(id);
  if (!resolve) return;
  confirmResolvers.delete(id);
  resolve(value);
}

