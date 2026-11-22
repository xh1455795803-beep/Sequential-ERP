import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { User, Mail, Phone, KeyRound, Loader2, Volume2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { PageHeader } from "@/components/page-header";
import { Switch } from "@/components/ui/switch";
import { isNotifySoundOn, setNotifySoundOn, playNotifyDingdong } from "@/lib/notify-sound";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";

// Wave A/T11：账号注销（申请 -> 30 天宽限 -> 匿名化）。
// 协议细节全部收在 @/lib/account-deletion，这个页面只管展示与两个按钮。
import {
  deletionText,
  fetchDeletionState,
  formatGraceDate,
  cancelDeletion,
  requestDeletion,
  type DeletionState,
} from "@/lib/account-deletion";

export const Route = createFileRoute("/_layout/profile")({
  component: Profile,
});

function Profile() {
  const { t, lang } = useLanguage();
  const { user } = useAuth();
  const [soundOn, setSoundOn] = useState(isNotifySoundOn());
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [saving, setSaving] = useState(false);

  // 注销卡片的状态
  const [delState, setDelState] = useState<DeletionState | null>(null);
  const [delLoading, setDelLoading] = useState(true);
  const [delBusy, setDelBusy] = useState(false);
  const [delAck, setDelAck] = useState(false);
  const [delWord, setDelWord] = useState("");

  const reloadDelState = async () => {
    setDelLoading(true);
    try {
      setDelState(await fetchDeletionState());
    } finally {
      setDelLoading(false);
    }
  };

  useEffect(() => {
    void reloadDelState();
  }, []);

  const displayName = user?.user_metadata?.username || user?.email || user?.phone || t("profile.user");
  const email = user?.email || t("profile.noEmail");
  const phone = user?.phone || t("profile.noPhone");

  const handleChangePwd = async () => {
    if (!newPwd || !confirmPwd) {
      toast.error(t("profile.fillPwd"));
      return;
    }
    if (newPwd.length < 6) {
      toast.error(t("profile.pwdMin"));
      return;
    }
    if (newPwd !== confirmPwd) {
      toast.error(t("profile.pwdMismatch"));
      return;
    }
    setSaving(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPwd });
      if (error) throw new Error(error.message);
      toast.success(t("profile.pwdSuccess"));
      setOldPwd("");
      setNewPwd("");
      setConfirmPwd("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : t("profile.pwdFail"));
    } finally {
      setSaving(false);
    }
  };

  const handleRequestDeletion = async () => {
    if (!delAck || delWord.trim().toUpperCase() !== "DELETE") return;
    setDelBusy(true);
    try {
      const res = await requestDeletion("self-service");
      if (res.ok) {
        toast.success(deletionText(lang, "requested"));
        setDelAck(false);
        setDelWord("");
        await reloadDelState();
      } else {
        toast.error(res.status === 429 ? deletionText(lang, "busy") : deletionText(lang, "fail"));
      }
    } finally {
      setDelBusy(false);
    }
  };

  const handleCancelDeletion = async () => {
    setDelBusy(true);
    try {
      const res = await cancelDeletion();
      if (res.ok) {
        toast.success(deletionText(lang, "cancelled"));
        await reloadDelState();
      } else {
        toast.error(res.status === 429 ? deletionText(lang, "busy") : deletionText(lang, "fail"));
      }
    } finally {
      setDelBusy(false);
    }
  };

  return (
    <div className="space-y-5">
      <PageHeader title={t("profile.title")} description={t("profile.desc")} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 账号信息 */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-base font-medium">{t("profile.accountInfo")}</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-primary text-lg font-semibold text-primary-foreground">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <div className="font-medium">{displayName}</div>
                <div className="text-xs text-muted-foreground">{t("profile.currentAccount")}</div>
              </div>
            </div>
            <div className="space-y-3 border-t border-border pt-4">
              <div className="flex items-center gap-3 text-sm">
                <User size={16} className="text-muted-foreground" />
                <span className="w-20 text-muted-foreground">{t("profile.username")}</span>
                <span className="font-medium">{displayName}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Mail size={16} className="text-muted-foreground" />
                <span className="w-20 text-muted-foreground">{t("profile.email")}</span>
                <span className="font-medium">{email}</span>
              </div>
              <div className="flex items-center gap-3 text-sm">
                <Phone size={16} className="text-muted-foreground" />
                <span className="w-20 text-muted-foreground">{t("profile.phone")}</span>
                <span className="font-medium">{phone}</span>
              </div>
            </div>
          </div>
        </div>

        {/* 修改密码 */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-medium">
            <KeyRound size={16} className="text-primary" /> {t("profile.changePwd")}
          </h2>
          <div className="space-y-4">
            <div className="grid gap-1.5">
              <Label htmlFor="new-pwd">{t("profile.newPwd")}</Label>
              <Input
                id="new-pwd"
                type="password"
                value={newPwd}
                onChange={(e) => setNewPwd(e.target.value)}
                placeholder={t("profile.pwdPlaceholder")}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="confirm-pwd">{t("profile.confirmPwd")}</Label>
              <Input
                id="confirm-pwd"
                type="password"
                value={confirmPwd}
                onChange={(e) => setConfirmPwd(e.target.value)}
                placeholder={t("profile.confirmPlaceholder")}
              />
            </div>
            <Button onClick={handleChangePwd} disabled={saving} className="w-full">
              {saving && <Loader2 size={15} className="mr-1 animate-spin" />}
              {t("profile.confirm")}
            </Button>
          </div>
        </div>

        {/* 偏好设置：通知声音开关（主人 UI 规范 Batch2） */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-base font-medium">
            <Volume2 size={16} className="text-primary" /> {t("profile.preferences")}
          </h2>
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="text-sm font-medium">{t("profile.notifySound")}</div>
              <p className="mt-0.5 text-xs text-muted-foreground">{t("profile.notifySoundDesc")}</p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={() => playNotifyDingdong({ force: true })}>
                {t("profile.soundTest")}
              </Button>
              <Switch
                checked={soundOn}
                onCheckedChange={(v) => {
                  setSoundOn(v);
                  setNotifySoundOn(v);
                  if (v) playNotifyDingdong({ force: true });
                }}
              />
            </div>
          </div>
        </div>

        {/* 危险操作：账号注销（Wave A/T11） */}
        <div className="rounded-xl border border-destructive/40 bg-card p-5 shadow-sm lg:col-span-2">
          <h2 className="mb-4 flex items-center gap-2 text-base font-medium">
            <ShieldAlert size={16} className="text-destructive" /> {deletionText(lang, "sectionTitle")}
          </h2>

          {delLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 size={15} className="animate-spin" /> {t("common.loading")}
            </div>
          ) : delState ? (
            <div className="space-y-4">
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
                {deletionText(lang, "statusPending")}{" "}
                <span className="font-medium">{formatGraceDate(delState.grace_until, lang)}</span>{" "}
                {deletionText(lang, "statusPendingTail")}
              </div>
              <Button variant="outline" onClick={handleCancelDeletion} disabled={delBusy}>
                {delBusy && <Loader2 size={15} className="mr-1 animate-spin" />}
                {deletionText(lang, "cancelBtn")}
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">{deletionText(lang, "intro")}</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {deletionText(lang, "retained")}
              </p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                {deletionText(lang, "subAccounts")}
              </p>
              <div className="flex items-start gap-2 pt-1">
                <Checkbox
                  id="del-ack"
                  checked={delAck}
                  onCheckedChange={(v) => setDelAck(v === true)}
                  className="mt-0.5"
                />
                <Label htmlFor="del-ack" className="cursor-pointer select-none text-sm font-normal">
                  {deletionText(lang, "checkbox")}
                </Label>
              </div>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="grid flex-1 gap-1.5">
                  <Label htmlFor="del-word" className="text-xs font-normal text-muted-foreground">
                    {deletionText(lang, "typeToConfirm")}
                  </Label>
                  <Input
                    id="del-word"
                    value={delWord}
                    onChange={(e) => setDelWord(e.target.value)}
                    autoComplete="off"
                    placeholder="DELETE"
                  />
                </div>
                <Button
                  variant="destructive"
                  onClick={handleRequestDeletion}
                  disabled={delBusy || !delAck || delWord.trim().toUpperCase() !== "DELETE"}
                  className="sm:mt-5"
                >
                  {delBusy && <Loader2 size={15} className="mr-1 animate-spin" />}
                  {deletionText(lang, "requestBtn")}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
