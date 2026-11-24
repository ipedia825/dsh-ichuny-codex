window.__ModuleLoader__.load({
  id: "@ipedia/dsh-ichuny-codex/client",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const jsx = require("react/jsx-runtime");
    const reactDom = require("react-dom");
    const passthroughCodec = (typeSymbol) => ({ mode: "strict", typeSymbol, create: () => ({ parse: (value) => value }), jsonSchema: { type: "object" } });
    const oauthRemoteDescriptor = (method) => ({
      id: `@ipedia/dsh-ichuny-codex#dshIchunyCodex/${method}`,
      namespace: "dshIchunyCodex",
      method,
      service: "siwcRemote",
      description: `ChatGPT OAuth ${method}.`,
      invocation: { kind: "direct" },
      parameters: [],
      result: passthroughCodec(`@ipedia/dsh-ichuny-codex#dshIchunyCodex/${method}:result`),
      input: () => ({ parse: () => ({}) }),
      invoke: (remote) => remote.dshIchunyCodex[method](),
      sourceLocation: { file: "src/oauth-controller.ts", line: 1, column: 1 }
    });
    const OAUTH_REMOTE = {
      package: "@ipedia/dsh-ichuny-codex",
      descriptors: ["status", "start", "cancel", "disconnect"].map(oauthRemoteDescriptor)
    };


    const EMPTY_SELECTION = { lastUsed: null, pending: null };
    const emptySelection = () => EMPTY_SELECTION;
    const noSubscription = () => () => {};
    const QUOTA_CACHE_MS = 5 * 60 * 1000;
    const quotaCache = { value: null, updatedAt: 0 };
    const cachedQuota = () => Date.now() - quotaCache.updatedAt < QUOTA_CACHE_MS ? quotaCache.value : null;

    const QUOTA_CSS = `
      .ipedia-codex-row{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:28px;font-size:12px;line-height:20px}
      .ipedia-codex-label{display:inline-flex;align-items:center;gap:7px;min-width:0}
      .ipedia-codex-swatch{flex:none;width:7px;height:7px;border-radius:2px;background:var(--dsw-alias-state-business-primary)}
      .ipedia-codex-row:nth-of-type(3) .ipedia-codex-swatch{background:var(--dsw-alias-state-warn-primary)}
      .ipedia-codex-row:nth-of-type(4) .ipedia-codex-swatch{background:var(--dsw-alias-label-tertiary)}
      .ipedia-codex-value{position:relative;flex:none;color:var(--dsw-alias-label-primary);font-weight:500;font-variant-numeric:tabular-nums}
      .ipedia-codex-value[data-reset]{cursor:help;outline-offset:3px}
      .ipedia-codex-value[data-reset]:hover::after,.ipedia-codex-value[data-reset]:focus-visible::after{content:attr(data-reset);position:absolute;right:0;top:calc(100% + 5px);z-index:2;max-width:220px;padding:5px 8px;border-radius:4px;background:var(--dsw-specific-menu);color:var(--dsw-alias-label-primary);box-shadow:var(--dsw-elevation-prominent,0 4px 16px #0003);border:1px solid var(--dsw-alias-border-l1);white-space:nowrap;font-size:12px;font-weight:400;pointer-events:none}
    `;

    function percentRemaining(window) {
      if (window === null || typeof window !== "object" || typeof window.usedPercent !== "number") return null;
      return Math.max(0, Math.min(100, 100 - window.usedPercent));
    }

    function relativeResetText(value) {
      if (typeof value !== "number" || !Number.isFinite(value)) return "重置时间不可用";
      const seconds = Math.max(0, Math.floor(value - Date.now() / 1000));
      if (seconds === 0) return "即将重置";
      const days = Math.floor(seconds / 86400);
      const hours = Math.floor(seconds % 86400 / 3600);
      const minutes = Math.floor(seconds % 3600 / 60);
      if (days > 0) return `${days}天${hours}小时后重置`;
      if (hours > 0) return `${hours}小时${minutes}分钟后重置`;
      return `${Math.max(1, minutes)}分钟后重置`;
    }

    function windowDetails(label, value) {
      const remaining = percentRemaining(value);
      const reset = value && typeof value === "object" ? relativeResetText(value.resetsAt) : null;
      return jsx.jsxs("div", {
        className: "ipedia-codex-row",
        children: [
          jsx.jsxs("span", {
            className: "ipedia-codex-label",
            children: [jsx.jsx("span", { className: "ipedia-codex-swatch", "aria-hidden": true }), label]
          }),
          jsx.jsx("span", {
            className: "ipedia-codex-value",
            ...(reset === null ? {} : { "data-reset": reset, "aria-label": `${label}剩余${remaining ?? "未知"}%，${reset}`, tabIndex: 0 }),
            children: remaining === null ? "不可用" : `剩余 ${remaining}%`
          })
        ]
      });
    }

    function QuotaPill({ modelDirectory }) {
      const [snapshot, setSnapshot] = React.useState(cachedQuota);
      const [open, setOpen] = React.useState(false);
      const [position, setPosition] = React.useState(null);
      const rootRef = React.useRef(null);
      const panelRef = React.useRef(null);
      const updatePosition = () => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return;
        const width = Math.min(264, Math.max(0, window.innerWidth - 24));
        const left = Math.max(12, Math.min(rect.right - width, window.innerWidth - width - 12));
        setPosition({ left, top: rect.top >= 200 ? rect.top - 8 : rect.bottom + 8, above: rect.top >= 200 });
      };
      const selection = React.useSyncExternalStore(
        modelDirectory?.subscribe ?? noSubscription,
        modelDirectory?.getSnapshot ?? emptySelection,
        modelDirectory?.getSnapshot ?? emptySelection
      );
      const selected = selection?.pending ?? selection?.current;
      const provider = selected?.provider;
      const isCodex = provider === "my-codex";
      React.useEffect(() => {
        if (!isCodex) {
          setOpen(false);
          return undefined;
        }
        let active = true;
        const load = () => fetch("/api/dsh-ichuny-codex/rate-limits", { cache: "no-store" })
          .then((response) => response.ok ? response.json() : null)
          .then((value) => {
            if (!active) return;
            if (value?.available === true) {
              quotaCache.value = value;
              quotaCache.updatedAt = Date.now();
              setSnapshot(value);
            } else if (cachedQuota() === null) setSnapshot(null);
          })
          .catch(() => { if (active && cachedQuota() === null) setSnapshot(null); });
        load();
        const timer = window.setInterval(load, 300000);
        return () => { active = false; window.clearInterval(timer); };
      }, [isCodex, provider, selected?.model]);
      React.useEffect(() => {
        if (!open) return undefined;
        const close = (event) => {
          if (rootRef.current?.contains(event.target) || panelRef.current?.contains(event.target)) return;
          setOpen(false);
        };
        const escape = (event) => { if (event.key === "Escape") setOpen(false); };
        document.addEventListener("pointerdown", close);
        document.addEventListener("keydown", escape);
        window.addEventListener("resize", updatePosition);
        window.addEventListener("scroll", updatePosition, true);
        return () => {
          document.removeEventListener("pointerdown", close);
          document.removeEventListener("keydown", escape);
          window.removeEventListener("resize", updatePosition);
          window.removeEventListener("scroll", updatePosition, true);
        };
      }, [open]);
      if (!isCodex || snapshot?.available !== true) return null;
      const primary = percentRemaining(snapshot.primary);
      const credits = snapshot.credits;
      if (primary === null && credits === null) return null;
      const details = jsx.jsxs("div", {
        ref: panelRef,
        role: "dialog",
        "aria-label": "Codex 额度详情",
        style: {
          position: "fixed",
          left: position?.left ?? 12,
          top: position?.top ?? 12,
          transform: position?.above ? "translateY(-100%)" : undefined,
          zIndex: 1100,
          width: "min(264px, calc(100vw - 24px))",
          maxHeight: "calc(100dvh - 24px)",
          overflow: "visible",
          boxSizing: "border-box",
          padding: "12px",
          borderRadius: "8px",
          background: "var(--dsw-specific-menu, var(--dsw-alias-bg-layer-1))",
          color: "var(--dsw-alias-label-secondary)",
          boxShadow: "var(--dsw-elevation-prominent, 0 8px 28px #0003)",
          fontSize: "12px",
          lineHeight: "20px"
        },
        children: [
          jsx.jsxs("div", { style: { display: "flex", justifyContent: "space-between", gap: "8px", paddingBottom: "8px", marginBottom: "4px", borderBottom: "1px solid var(--dsw-alias-border-l1)" }, children: [jsx.jsx("span", { style: { color: "var(--dsw-alias-label-tertiary)" }, children: "额度来源" }), jsx.jsx("span", { style: { color: "var(--dsw-alias-label-primary)", fontWeight: 500 }, children: snapshot.planType ? `${String(snapshot.planType).toUpperCase()} 套餐` : "Codex" })] }),
          windowDetails("5 小时", snapshot.primary),
          windowDetails("一周", snapshot.secondary),
          jsx.jsxs("div", {
            className: "ipedia-codex-row",
            children: [
              jsx.jsxs("span", { className: "ipedia-codex-label", children: [jsx.jsx("span", { className: "ipedia-codex-swatch", "aria-hidden": true }), "额度余额"] }),
              jsx.jsx("span", { className: "ipedia-codex-value", children: credits?.unlimited ? "无限" : credits?.hasCredits ? credits.balance ?? "未知" : "0" })
            ]
          })
        ]
      });
      return jsx.jsxs("span", {
        ref: rootRef,
        style: { order: 2, position: "relative", display: "inline-flex" },
        children: [
          jsx.jsx("button", {
            type: "button",
            title: "查看 Codex 额度详情",
            "aria-label": "查看 Codex 额度详情",
            "aria-expanded": open,
            onClick: () => { if (!open) updatePosition(); setOpen(!open); },
            style: {
              border: 0,
              borderRadius: "var(--dsw-radius-sm, 4px)",
              color: "var(--dsw-alias-label-tertiary)",
              background: open ? "var(--dsw-alias-interactive-bg-hover)" : "transparent",
              font: "inherit",
              fontSize: "var(--dsh-content-font-size-secondary,13px)",
              fontVariantNumeric: "tabular-nums",
              lineHeight: "calc(20px + var(--dsh-content-font-delta-secondary,0px))",
              whiteSpace: "nowrap",
              cursor: "pointer",
              padding: "1px 8px"
            },
            children: `codex ${primary === null ? "--" : `${primary}%`}`
          }),
          open && reactDom.createPortal(details, document.body)
        ]
      });
    }

    const CONNECTION_NS = "chatgptConnections";
    const CONNECTION_DICTIONARIES = {
      zh: {
        nav: "ChatGPT 连接",
        preference: "新会话首选方式",
        preferenceHint: "只保存偏好；新会话仍需在模型选择器中选择。",
        local: "本地 ChatGPT",
        oauth: "ChatGPT OAuth",
        connected: "已连接",
        signedOut: "未登录",
        failed: "检查失败",
        loading: "检查中",
        refresh: "重新检查",
        models: "模型",
        quota: "5 小时额度",
        checked: "检查时间",
        localHint: "使用本机 Codex 登录；插件不会读取或复制 Codex 凭据。",
        loginHint: "请先在终端运行 codex login，然后重新检查。",
        oauthPreview: "OAuth Preview",
        oauthHint: "官方 SIWC Preview 登录已可连接；模型 provider 将独立注册，失败时不会回退到本地。",
        authorizing: "授权中",
        connect: "连接",
        cancel: "取消授权",
        disconnect: "断开连接",
        expires: "凭据到期",
        usage: "查看 ChatGPT 用量",
        actionFailed: "操作失败，请重试。",
        continueAuthorization: "继续 ChatGPT 授权",
        unavailable: "此配置当前不可写。",
        saveFailed: "首选方式保存失败，请重试。",
      },
      en: {
        nav: "ChatGPT connections",
        preference: "Preferred connection for new chats",
        preferenceHint: "This saves a preference only; select the model when starting a new chat.",
        local: "Local ChatGPT",
        oauth: "ChatGPT OAuth",
        connected: "Connected",
        signedOut: "Signed out",
        failed: "Check failed",
        loading: "Checking",
        refresh: "Check again",
        models: "Models",
        quota: "5-hour quota",
        checked: "Checked",
        localHint: "Uses the local Codex login. The plugin never reads or copies Codex credentials.",
        loginHint: "Run codex login in a terminal, then check again.",
        oauthPreview: "OAuth Preview",
        oauthHint: "Official SIWC Preview sign-in is available. The model provider registers independently and never falls back locally.",
        authorizing: "Authorizing",
        connect: "Connect",
        cancel: "Cancel authorization",
        disconnect: "Disconnect",
        expires: "Credential expiry",
        usage: "View ChatGPT usage",
        actionFailed: "The action failed. Try again.",
        continueAuthorization: "Continue ChatGPT authorization",
        unavailable: "This configuration is not writable.",
        saveFailed: "Could not save the preference. Try again.",
      },
    };
    const CONNECTION_CSS = `
      .ipedia-connections{max-width:760px;padding:8px 0 32px;color:var(--dsw-alias-label-primary)}
      .ipedia-connections h2{margin:0;font-size:20px;line-height:28px;font-weight:600;letter-spacing:0}
      .ipedia-connections p{margin:0;color:var(--dsw-alias-label-secondary);font-size:14px;line-height:22px;letter-spacing:0}
      .ipedia-connections-pref{display:flex;align-items:flex-start;justify-content:space-between;gap:24px;padding:20px 0;border-bottom:1px solid var(--dsw-alias-border-l1)}
      .ipedia-connections-pref-copy{display:grid;gap:4px;min-width:0}
      .ipedia-connections-segment{display:inline-flex;flex:none;padding:3px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1)}
      .ipedia-connections-segment button,.ipedia-connections-tabs button{min-height:36px;border:0;border-radius:6px;padding:6px 12px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:14px;line-height:20px;letter-spacing:0;cursor:pointer}
      .ipedia-connections-segment button[aria-pressed=true],.ipedia-connections-tabs button[aria-selected=true]{background:var(--dsw-alias-card-fill);color:var(--dsw-alias-label-primary);font-weight:500}
      .ipedia-connections-segment button:disabled{cursor:not-allowed;opacity:.48}
      .ipedia-connections-tabs{display:flex;gap:4px;padding:20px 0 12px}
      .ipedia-connections-tabs button{min-height:44px;padding:10px 12px}
      .ipedia-connections button:focus-visible{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:2px}
      .ipedia-connection-panel{display:grid;gap:16px;padding:20px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-card-fill)}
      .ipedia-connection-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px}
      .ipedia-connection-title{display:grid;gap:4px;min-width:0}
      .ipedia-connection-status{display:inline-flex;align-items:center;gap:8px;min-height:28px;font-size:13px;font-weight:500;white-space:nowrap}
      .ipedia-connection-status::before{content:"";width:8px;height:8px;border-radius:50%;background:var(--dsw-alias-label-tertiary)}
      .ipedia-connection-status[data-status=connected]::before{background:var(--dsw-alias-state-success-primary)}
      .ipedia-connection-status[data-status=error]::before{background:var(--dsw-alias-state-error-primary)}
      .ipedia-connection-status[data-status=signed-out]::before{background:var(--dsw-alias-state-warn-primary)}
      .ipedia-connection-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}
      .ipedia-connection-stat{display:grid;gap:4px;min-width:0}
      .ipedia-connection-stat span{color:var(--dsw-alias-label-secondary);font-size:12px;line-height:20px}
      .ipedia-connection-stat strong{font-size:14px;line-height:22px;font-weight:500;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
      .ipedia-connection-actions{display:flex;align-items:center;gap:12px;min-height:44px}
      .ipedia-connection-actions button{min-height:40px;padding:8px 14px;border:1px solid var(--dsw-alias-border-l1);border-radius:6px;background:var(--dsw-alias-card-fill);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;cursor:pointer}
      .ipedia-connection-actions button:disabled{cursor:wait;opacity:.55}
      .ipedia-connection-error{color:var(--dsw-alias-state-error-primary)!important}
      @media(max-width:640px){.ipedia-connections-pref{flex-direction:column}.ipedia-connections-segment{width:100%}.ipedia-connections-segment button{flex:1}.ipedia-connection-stats{grid-template-columns:1fr}.ipedia-connection-head{flex-direction:column}}
    `;

    const emptyFormSnapshot = () => ({ status: "unavailable", value: undefined, writable: false });
    const noFormSubscription = () => () => {};
    function isConnectionStatus(value) {
      return value !== null && typeof value === "object"
        && ["connected", "signed-out", "error"].includes(value.status)
        && typeof value.checkedAt === "number";
    }
    function localStatusText(t, state) {
      if (state.status === "connected") return t("connected");
      if (state.status === "signed-out") return t("signedOut");
      if (state.status === "error") return t("failed");
      return t("loading");
    }
    function quotaRemaining(quota) {
      const used = quota && typeof quota === "object" && quota.primary && typeof quota.primary.usedPercent === "number"
        ? quota.primary.usedPercent : null;
      return used === null ? "--" : `${Math.max(0, Math.min(100, 100 - used))}%`;
    }
    function isOAuthView(value) {
      return value !== null && typeof value === "object"
        && ["disconnected", "authorizing", "connected", "error"].includes(value.phase)
        && (value.email === undefined || typeof value.email === "string")
        && (value.expiresAt === undefined || typeof value.expiresAt === "number");
    }
    async function callOAuth(remote, method) {
      const namespace = typeof remote === "function" ? remote() : remote;
      const response = await namespace?.[method]?.();
      if (!response?.ok || !isOAuthView(response.value)) throw new Error("OAuth remote call failed");
      return response.value;
    }
    function isAuthorizationUrl(value) {
      try {
        const url = new URL(value);
        return url.origin === "https://auth.openai.com" && url.pathname === "/api/accounts/authorize" && !url.username && !url.password;
      } catch { return false; }
    }
    function oauthStatusText(t, state) {
      if (state.phase === "connected") return t("connected");
      if (state.phase === "authorizing") return t("authorizing");
      if (state.phase === "error") return t("failed");
      if (state.phase === "disconnected") return t("signedOut");
      return t("loading");
    }

    function ConnectionSection({ form, t, oauthRemote }) {
      const [activeTab, setActiveTab] = React.useState("local");
      const [localState, setLocalState] = React.useState({ status: "loading" });
      const [saveError, setSaveError] = React.useState(false);
      const [oauthState, setOauthState] = React.useState({ phase: "loading" });
      const [oauthBusy, setOauthBusy] = React.useState(false);
      const [oauthError, setOauthError] = React.useState(false);
      const [pendingUrl, setPendingUrl] = React.useState(null);
      const requestRef = React.useRef(null);
      const tabRefs = React.useRef([]);
      const formSnapshot = React.useSyncExternalStore(
        form?.subscribe ? form.subscribe.bind(form) : noFormSubscription,
        form?.getSnapshot ? form.getSnapshot.bind(form) : emptyFormSnapshot,
        form?.getSnapshot ? form.getSnapshot.bind(form) : emptyFormSnapshot
      );
      const loadLocal = () => {
        requestRef.current?.abort();
        const controller = new AbortController();
        requestRef.current = controller;
        setLocalState({ status: "loading" });
        fetch("/api/dsh-ichuny-codex/connection-status", { cache: "no-store", signal: controller.signal })
          .then(async (response) => {
            const value = await response.json();
            if (!isConnectionStatus(value)) throw new Error("invalid connection status");
            return value;
          })
          .then((value) => { if (!controller.signal.aborted) setLocalState(value); })
          .catch(() => { if (!controller.signal.aborted) setLocalState({ status: "error", checkedAt: Date.now() }); });
      };
      React.useEffect(() => {
        loadLocal();
        let active = true;
        callOAuth(oauthRemote, "status").then(value => { if (active) setOauthState(value); }).catch(() => { if (active) setOauthState({ phase: "error" }); });
        return () => { active = false; requestRef.current?.abort(); };
      }, []);
      React.useEffect(() => {
        if (oauthState.phase !== "authorizing") return undefined;
        let active = true;
        const timer = window.setInterval(() => {
          callOAuth(oauthRemote, "status").then(value => { if (active) setOauthState(value); }).catch(() => { if (active) setOauthState({ phase: "error" }); });
        }, 1500);
        return () => { active = false; window.clearInterval(timer); };
      }, [oauthState.phase]);
      const oauthAction = async (method) => {
        const popup = method === "start" ? window.open("about:blank", "_blank") : null;
        if (popup) popup.opener = null;
        setOauthBusy(true);
        setOauthError(false);
        try {
          const value = await callOAuth(oauthRemote, method);
          if (method === "start") {
            if (!isAuthorizationUrl(value.authorizationUrl)) throw new Error("Unexpected authorization URL");
            setPendingUrl(value.authorizationUrl);
            if (popup && !popup.closed) popup.location.replace(value.authorizationUrl);
          } else setPendingUrl(null);
          setOauthState(value);
        } catch {
          popup?.close();
          setOauthError(true);
          setOauthState({ phase: "error" });
        } finally {
          setOauthBusy(false);
        }
      };
      const selectPreference = async (next) => {
        if (!formSnapshot.writable || formSnapshot.status !== "ready" || !form?.set) return;
        setSaveError(false);
        try {
          if (!await form.set("preferredConnection", next)) setSaveError(true);
        } catch {
          setSaveError(true);
        }
      };
      const selectTab = (tab, index) => {
        setActiveTab(tab);
        tabRefs.current[index]?.focus();
      };
      const onTabKeyDown = (event) => {
        const index = activeTab === "local" ? 0 : 1;
        let next = index;
        if (event.key === "ArrowRight") next = (index + 1) % 2;
        else if (event.key === "ArrowLeft") next = (index + 1) % 2;
        else if (event.key === "Home") next = 0;
        else if (event.key === "End") next = 1;
        else return;
        event.preventDefault();
        selectTab(next === 0 ? "local" : "oauth", next);
      };
      const preferred = formSnapshot.value?.preferredConnection === "oauth" ? "oauth" : "local";
      const checked = typeof localState.checkedAt === "number"
        ? new Date(localState.checkedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "--";
      const localPanel = jsx.jsxs("section", {
        id: "ipedia-local-panel", role: "tabpanel", "aria-labelledby": "ipedia-local-tab",
        className: "ipedia-connection-panel", children: [
          jsx.jsxs("div", { className: "ipedia-connection-head", children: [
            jsx.jsxs("div", { className: "ipedia-connection-title", children: [
              jsx.jsx("h2", { children: t("local") }), jsx.jsx("p", { children: t("localHint") })
            ] }),
            jsx.jsx("span", { className: "ipedia-connection-status", "data-status": localState.status, "aria-live": "polite", children: localStatusText(t, localState) })
          ] }),
          jsx.jsxs("div", { className: "ipedia-connection-stats", children: [
            jsx.jsxs("div", { className: "ipedia-connection-stat", children: [jsx.jsx("span", { children: t("models") }), jsx.jsx("strong", { children: localState.status === "connected" && typeof localState.modelCount === "number" ? String(localState.modelCount) : "--" })] }),
            jsx.jsxs("div", { className: "ipedia-connection-stat", children: [jsx.jsx("span", { children: t("quota") }), jsx.jsx("strong", { children: quotaRemaining(localState.quota) })] }),
            jsx.jsxs("div", { className: "ipedia-connection-stat", children: [jsx.jsx("span", { children: t("checked") }), jsx.jsx("strong", { children: checked })] })
          ] }),
          localState.status === "signed-out" && jsx.jsx("p", { children: t("loginHint") }),
          localState.status === "error" && jsx.jsx("p", { className: "ipedia-connection-error", children: typeof localState.error === "string" ? localState.error : t("failed") }),
          jsx.jsx("div", { className: "ipedia-connection-actions", children: jsx.jsx("button", { type: "button", disabled: localState.status === "loading", onClick: loadLocal, children: t("refresh") }) })
        ]
      });
      const oauthExpiry = typeof oauthState.expiresAt === "number" ? new Date(oauthState.expiresAt).toLocaleString() : "--";
      const oauthPanel = jsx.jsxs("section", {
        id: "ipedia-oauth-panel", role: "tabpanel", "aria-labelledby": "ipedia-oauth-tab",
        className: "ipedia-connection-panel", children: [
          jsx.jsxs("div", { className: "ipedia-connection-head", children: [
            jsx.jsxs("div", { className: "ipedia-connection-title", children: [jsx.jsx("h2", { children: t("oauth") }), jsx.jsx("p", { children: t("oauthHint") })] }),
            jsx.jsx("span", { className: "ipedia-connection-status", "data-status": oauthState.phase === "disconnected" ? "signed-out" : oauthState.phase, "aria-live": "polite", children: oauthStatusText(t, oauthState) })
          ] }),
          oauthState.phase === "connected" && jsx.jsxs("div", { className: "ipedia-connection-stats", children: [
            jsx.jsxs("div", { className: "ipedia-connection-stat", children: [jsx.jsx("span", { children: "Email" }), jsx.jsx("strong", { children: oauthState.email ?? "--" })] }),
            jsx.jsxs("div", { className: "ipedia-connection-stat", children: [jsx.jsx("span", { children: t("expires") }), jsx.jsx("strong", { children: oauthExpiry })] })
          ] }),
          oauthError && jsx.jsx("p", { className: "ipedia-connection-error", role: "alert", children: t("actionFailed") }),
          oauthState.phase === "authorizing" && pendingUrl && jsx.jsx("a", { href: pendingUrl, target: "_blank", rel: "noopener noreferrer", children: t("continueAuthorization") }),
          jsx.jsxs("div", { className: "ipedia-connection-actions", children: [
            oauthState.phase !== "connected" && oauthState.phase !== "authorizing" && jsx.jsx("button", { type: "button", disabled: oauthBusy, onClick: () => oauthAction("start"), children: t("connect") }),
            oauthState.phase === "authorizing" && jsx.jsx("button", { type: "button", disabled: oauthBusy, onClick: () => oauthAction("cancel"), children: t("cancel") }),
            oauthState.phase === "connected" && jsx.jsx("button", { type: "button", disabled: oauthBusy, onClick: () => oauthAction("disconnect"), children: t("disconnect") }),
            oauthState.phase === "connected" && jsx.jsx("a", { href: "https://chatgpt.com/settings/usage", target: "_blank", rel: "noopener noreferrer", children: t("usage") })
          ] })
        ]
      });
      return jsx.jsxs("div", { className: "ipedia-connections", children: [
        jsx.jsxs("div", { className: "ipedia-connections-pref", children: [
          jsx.jsxs("div", { className: "ipedia-connections-pref-copy", children: [jsx.jsx("h2", { children: t("preference") }), jsx.jsx("p", { children: t("preferenceHint") })] }),
          jsx.jsxs("div", { className: "ipedia-connections-segment", role: "group", "aria-label": t("preference"), children: [
            jsx.jsx("button", { type: "button", "aria-pressed": preferred === "local", disabled: !formSnapshot.writable, onClick: () => selectPreference("local"), children: t("local") }),
            jsx.jsx("button", { type: "button", "aria-pressed": preferred === "oauth", disabled: !formSnapshot.writable || oauthState.phase !== "connected", title: oauthState.phase === "connected" ? undefined : t("signedOut"), onClick: () => selectPreference("oauth"), children: t("oauth") })
          ] }),
          !formSnapshot.writable && jsx.jsx("p", { children: t("unavailable") }),
          saveError && jsx.jsx("p", { className: "ipedia-connection-error", role: "alert", children: t("saveFailed") })
        ] }),
        jsx.jsxs("div", { className: "ipedia-connections-tabs", role: "tablist", "aria-label": t("nav"), onKeyDown: onTabKeyDown, children: [
          jsx.jsx("button", { id: "ipedia-local-tab", ref: (node) => { tabRefs.current[0] = node; }, role: "tab", type: "button", "aria-selected": activeTab === "local", "aria-controls": "ipedia-local-panel", tabIndex: activeTab === "local" ? 0 : -1, onClick: () => selectTab("local", 0), children: t("local") }),
          jsx.jsx("button", { id: "ipedia-oauth-tab", ref: (node) => { tabRefs.current[1] = node; }, role: "tab", type: "button", "aria-selected": activeTab === "oauth", "aria-controls": "ipedia-oauth-panel", tabIndex: activeTab === "oauth" ? 0 : -1, onClick: () => selectTab("oauth", 1), children: t("oauth") })
        ] }),
        activeTab === "local" ? localPanel : oauthPanel
      ] });
    }

    const inject = ["slots", "modelDirectories", "locale", "configForms", "remote"];

    function apply(ctx) {
      ctx.effect(async () => {
        const dispose = await ctx.remote.$mount(OAUTH_REMOTE);
        return dispose;
      }, "dsh-ichuny-codex: OAuth Remote namespace");
      ctx.effect(() => ctx.locale.register(CONNECTION_NS, CONNECTION_DICTIONARIES), "dsh-ichuny-codex: connection dictionaries");
      ctx.effect(() => {
        if (!document.head || document.getElementById("ipedia-codex-client-style")) return undefined;
        const style = document.createElement("style");
        style.id = "ipedia-codex-client-style";
        style.textContent = QUOTA_CSS + CONNECTION_CSS;
        document.head.appendChild(style);
        return () => { style.remove(); };
      }, "dsh-ichuny-codex: client styles");
      ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
        name: "conversation.composer.dock",
        id: "dsh-ichuny-codex-quota",
        inject: (sessionId) => ({
          modelDirectory: ctx.modelDirectories.directoryFor(sessionId).store
        })
      }, QuotaPill));
      const t = ctx.locale.bind(CONNECTION_NS);
      const form = ctx.configForms.get("llm-codex");
      ctx.slots.inject("settings.section", () => ctx.slots.register({
        name: "settings.section",
        id: "chatgpt-connections",
        order: 35,
        label: () => t("nav"),
        locale: CONNECTION_NS,
        inject: () => ({ form, t, oauthRemote: () => ctx.get("remote.dshIchunyCodex") })
      }, ConnectionSection));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
