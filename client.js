window.__ModuleLoader__.load({
  id: "@ipedia/dsh-ichuny-codex/client",
  factory: (require) => {
    const module = { exports: {} };
    const exports = module.exports;
    const React = require("react");
    const jsx = require("react/jsx-runtime");
    const reactDom = require("react-dom");

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

    const inject = ["slots", "modelDirectories"];

    function apply(ctx) {
      if (document.head && !document.getElementById("ipedia-codex-quota-style")) {
        const style = document.createElement("style");
        style.id = "ipedia-codex-quota-style";
        style.textContent = QUOTA_CSS;
        document.head.appendChild(style);
      }
      ctx.slots.inject("conversation.composer.dock", () => ctx.slots.register({
        name: "conversation.composer.dock",
        id: "dsh-ichuny-codex-quota",
        inject: (sessionId) => ({
          modelDirectory: ctx.modelDirectories.directoryFor(sessionId).store
        })
      }, QuotaPill));
    }

    exports.apply = apply;
    exports.inject = inject;
    return module.exports;
  }
});
