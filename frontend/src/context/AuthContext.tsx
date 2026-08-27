import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { api } from "@/src/lib/api";
import { loadApiBase } from "@/src/lib/config";
import { deriveAndStoreKeypair, getExistingPublicKey } from "@/src/lib/crypto";

type User = {
  id: string;
  email: string;
  display_name: string;
  public_key: string;
  pair_id: string | null;
  partner_id: string | null;
};

type Partner = { id: string; display_name: string; public_key: string } | null;

type AuthState = {
  booting: boolean;
  token: string | null;
  user: User | null;
  partner: Partner;
  pairStatus: "none" | "pending" | "active";
  pairCode: string | null;
  signUp: (email: string, password: string, name: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  refreshPair: () => Promise<void>;
  createInvite: () => Promise<string>;
  redeemInvite: (code: string) => Promise<void>;
  unpairAndReset: () => Promise<void>;
};

const AuthCtx = createContext<AuthState>({} as AuthState);
export const useAuth = () => useContext(AuthCtx);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [booting, setBooting] = useState(true);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [partner, setPartner] = useState<Partner>(null);
  const [pairStatus, setPairStatus] = useState<"none" | "pending" | "active">("none");
  const [pairCode, setPairCode] = useState<string | null>(null);

  const refreshPair = useCallback(async () => {
    try {
      const res = await api.getPair();
      setPairStatus(res.status || "none");
      setPairCode(res.code || null);
      setPartner(res.partner || null);
    } catch {
      setPairStatus("none");
      setPartner(null);
    }
  }, []);

  const boot = useCallback(async () => {
    try {
      await loadApiBase();
      const t = await api.getToken();
      if (t) {
        setToken(t as string);
        const me = await api.me();
        setUser(me.user);
        // Ensure the device keypair matches the server's stored public key.
        const pub = await getExistingPublicKey();
        if (pub && pub !== me.user.public_key) {
          await api.updatePublicKey(pub);
          setUser({ ...me.user, public_key: pub });
        }
        await refreshPair();
      }
    } catch {
      await api.clearToken();
      setToken(null);
      setUser(null);
    } finally {
      setBooting(false);
    }
  }, [refreshPair]);

  useEffect(() => {
    boot();
  }, [boot]);

  const signUp = async (email: string, password: string, name: string) => {
    const public_key = await deriveAndStoreKeypair(password, email);
    const res = await api.register({ email, password, display_name: name, public_key });
    await api.setToken(res.access_token);
    setToken(res.access_token);
    setUser(res.user);
    setPairStatus("none");
  };

  const signIn = async (email: string, password: string) => {
    const res = await api.login({ email, password });
    await api.setToken(res.access_token);
    setToken(res.access_token);
    // Deterministically re-derive this device's key from the password so it
    // matches across reinstalls/new devices, then sync it to the server.
    const public_key = await deriveAndStoreKeypair(password, email);
    let u = res.user;
    if (public_key !== res.user.public_key) {
      await api.updatePublicKey(public_key);
      u = { ...res.user, public_key };
    }
    setUser(u);
    await refreshPair();
  };

  const signOut = async () => {
    await api.clearToken();
    setToken(null);
    setUser(null);
    setPartner(null);
    setPairStatus("none");
    setPairCode(null);
  };

  const createInvite = async () => {
    const res = await api.pairCreate();
    setPairCode(res.code);
    setPairStatus("pending");
    return res.code;
  };

  const redeemInvite = async (code: string) => {
    await api.pairRedeem(code);
    await refreshPair();
  };

  const unpairAndReset = async () => {
    try {
      await api.unpair();
    } catch {}
    setPartner(null);
    setPairStatus("none");
    setPairCode(null);
    setUser((u) => (u ? { ...u, pair_id: null, partner_id: null } : u));
  };

  return (
    <AuthCtx.Provider
      value={{
        booting,
        token,
        user,
        partner,
        pairStatus,
        pairCode,
        signUp,
        signIn,
        signOut,
        refreshPair,
        createInvite,
        redeemInvite,
        unpairAndReset,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}
