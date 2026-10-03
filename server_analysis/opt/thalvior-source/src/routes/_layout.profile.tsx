import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { User, Mail, Phone, KeyRound, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/page-header";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";
import { supabase } from "@/supabase/client";
import { useLanguage } from "@/i18n/LanguageContext";

export const Route = createFileRoute("/_layout/profile")({
  component: Profile,
});

function Profile() {
  const { t } = useLanguage();
  const { user } = useAuth();
  const [oldPwd, setOldPwd] = useState("");
  const [newPwd, setNewPwd] = useState("");
  const [confirmPwd, setConfirmPwd] = useState("");
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="space-y-5">
      <PageHeader title={t("profile.title")} description={t("profile.desc")} />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* 账号信息 */}
        <div className="rounded-xl border border-border bg-card p-5 shadow-sm">
          <h2 className="mb-4 text-sm font-semibold">{t("profile.accountInfo")}</h2>
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
          <h2 className="mb-4 flex items-center gap-2 text-sm font-semibold">
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
      </div>
    </div>
  );
}