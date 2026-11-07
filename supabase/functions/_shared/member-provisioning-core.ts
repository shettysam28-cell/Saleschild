function temporaryPasscode() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

export type ProvisioningRequest = {
  organizationId: string;
  operationId: string;
  email: string;
  name: string;
};
export type MemberAuthProvider = {
  create(
    request: ProvisioningRequest,
    passcode: string,
  ): Promise<
    { outcome: "created"; userId: string } | { outcome: "not-created" } | { outcome: "uncertain" }
  >;
  reset(userId: string, provisioningId: string, passcode: string): Promise<boolean>;
};
export type MemberProvisioningStore = {
  reserve(request: ProvisioningRequest): Promise<boolean>;
  attach(request: ProvisioningRequest, userId: string): Promise<void>;
  fail(request: ProvisioningRequest): Promise<void>;
  beginReset(organizationId: string, userId: string): Promise<string>;
  finishReset(organizationId: string, userId: string): Promise<void>;
};
export type MemberCredentialResult = {
  success: boolean;
  message: string;
  temporaryPasscode?: string;
};

/** Credentials exist only in this response, never in the provisioning store. */
export async function provisionMemberWithProvider(
  request: ProvisioningRequest,
  provider: MemberAuthProvider,
  store: MemberProvisioningStore,
): Promise<MemberCredentialResult> {
  const created = await store.reserve(request);
  if (!created)
    return {
      success: false,
      message:
        "This account request already exists. A previous passcode cannot be retrieved. Review its status or request reconciliation; account creation will not be repeated.",
    };
  const passcode = temporaryPasscode();
  let result: Awaited<ReturnType<MemberAuthProvider["create"]>>;
  try {
    result = await provider.create(request, passcode);
  } catch {
    result = { outcome: "uncertain" };
  }
  if (result.outcome === "not-created") {
    await store.fail(request);
    return {
      success: false,
      message:
        "The identity could not be provisioned. An existing account was not changed. Review the member details before trying again.",
    };
  }
  if (result.outcome === "uncertain")
    return {
      success: false,
      message:
        "Account creation could not be confirmed. The seat remains reserved for reconciliation; do not create another account.",
    };
  try {
    await store.attach(request, result.userId);
  } catch {
    return {
      success: false,
      message:
        "The account was created but workspace setup is incomplete. Access remains blocked and the seat is reserved for reconciliation.",
    };
  }
  return {
    success: true,
    message:
      "Provisioned, awaiting verified first login. Copy this temporary passcode now; it cannot be retrieved later. It expires in 48 hours.",
    temporaryPasscode: passcode,
  };
}

export async function resetMemberWithProvider(
  organizationId: string,
  userId: string,
  provider: MemberAuthProvider,
  store: MemberProvisioningStore,
): Promise<MemberCredentialResult> {
  // Revoke ordinary tenant access before touching Auth. A partial failure never
  // restores an old session or grants access through a stale credential.
  const provisioningId = await store.beginReset(organizationId, userId);
  const passcode = temporaryPasscode();
  let changed = false;
  try {
    changed = await provider.reset(userId, provisioningId, passcode);
    if (changed) await store.finishReset(organizationId, userId);
    else throw new Error("Reset unavailable");
  } catch {
    return {
      success: false,
      message:
        "Password reset could not be confirmed. Workspace access stays blocked until the reset is reconciled. No existing unrelated account was changed.",
    };
  }
  return {
    success: true,
    message:
      "Copy the replacement temporary passcode now. The previous passcode is invalid and setup is required again.",
    temporaryPasscode: passcode,
  };
}
