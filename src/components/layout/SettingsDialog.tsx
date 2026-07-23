import {useEffect, useState} from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {Switch} from '@/components/ui/switch';
import {Separator} from '@/components/ui/separator';
import {Input} from '@/components/ui/input';
import {Tabs, TabsList, TabsTrigger, TabsContent} from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {Button} from '@/components/ui/button';
import {useTheme} from '@/hooks/use-theme';
import {useAppState} from '../../context/AppStateContext';
import {settingsService} from '../../services/settingsService';
import {cn} from '@/lib/utils';
import {toast} from '@/lib/toast';
import {Globe, Moon, Bell, Settings, User} from 'lucide-react';

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export default function SettingsDialog({ open, onOpenChange }: SettingsDialogProps) {
  const { t, isDarkMode, toggleDarkMode, lang, setLang, cls } = useTheme();
  const { currentUser, refreshCurrentUser } = useAppState();
  const [notificationsEnabled, setNotificationsEnabled] = useState(false);

  const [userName, setUserName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setUserName(currentUser?.userName ?? '');
    }
  }, [open, currentUser]);

  const handleSaveUserName = async () => {
    setSaving(true);
    try {
      await settingsService.update({userName: userName.trim()});
      await refreshCurrentUser();
      toast.info(t.settingsAccountSaved ?? '账号信息已保存');
    } catch (err) {
      toast.error(t.settingsAccountSaveFailed ?? '保存失败', err instanceof Error ? err.message : undefined);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent overlayClassName="bg-black/30" className="sm:max-w-[480px] p-0 gap-0">
        <DialogHeader className="p-6 pb-4">
          <DialogTitle className="flex items-center gap-2 text-base font-semibold">
            <Settings className="w-5 h-5" />
            {t.settings ?? '设置'}
          </DialogTitle>
          <DialogDescription>
            {t.settingsDescription ?? '管理账号、语言、主题、通知等应用偏好'}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="account" className="px-6 pb-6">
          <TabsList className="w-full grid grid-cols-3 mb-4">
            <TabsTrigger value="account">{t.settingsTabAccount ?? '账号'}</TabsTrigger>
            <TabsTrigger value="appearance">{t.settingsTabAppearance ?? '外观'}</TabsTrigger>
            <TabsTrigger value="notifications">{t.settingsTabNotifications ?? '通知'}</TabsTrigger>
          </TabsList>

          {/* 账号 */}
          <TabsContent value="account" className="space-y-3 mt-0">
            <div
              className={cn(
                'flex flex-col gap-3 p-4 rounded-xl border',
                cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'),
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/20 flex items-center justify-center">
                  <User className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t.settingsUserName ?? '用户名'}</p>
                  <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
                    {t.settingsUserNameDesc ?? '用于个性化问候语，本轮不涉及账号体系'}
                  </p>
                </div>
              </div>
              <Input
                value={userName}
                onChange={(e) => setUserName(e.target.value)}
                placeholder={t.settingsUserNamePlaceholder ?? '请输入用户名'}
                className="w-full"
              />
              <div className="flex justify-end">
                <Button size="sm" onClick={handleSaveUserName} disabled={saving}>
                  {saving ? '...' : (t.save ?? '保存')}
                </Button>
              </div>
            </div>
          </TabsContent>

          {/* 外观 */}
          <TabsContent value="appearance" className="space-y-1 mt-0">
            <div
              className={cn(
                'flex items-center justify-between p-3 rounded-xl border',
                cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'),
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-blue-50 dark:bg-blue-950/20 flex items-center justify-center">
                  <Globe className="w-4 h-4 text-blue-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t.settingsLanguage ?? '语言'}</p>
                  <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
                    {lang === 'zh' ? '简体中文' : 'English'}
                  </p>
                </div>
              </div>
              <Select value={lang} onValueChange={(value) => setLang(value as 'zh' | 'en')}>
                <SelectTrigger className="w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent position="popper" sideOffset={4}>
                  <SelectItem value="zh">简体中文</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <Separator />

            <div
              className={cn(
                'flex items-center justify-between p-3 rounded-xl border',
                cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'),
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-purple-50 dark:bg-purple-950/20 flex items-center justify-center">
                  <Moon className="w-4 h-4 text-purple-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t.settingsDarkMode ?? '深色模式'}</p>
                  <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
                    {isDarkMode ? '已开启' : '已关闭'}
                  </p>
                </div>
              </div>
              <Switch checked={isDarkMode} onCheckedChange={toggleDarkMode} />
            </div>
          </TabsContent>

          {/* 通知 */}
          <TabsContent value="notifications" className="space-y-1 mt-0">
            <div
              className={cn(
                'flex items-center justify-between p-3 rounded-xl border',
                cls('bg-white border-gray-100', 'bg-[#1c1c1f] border-white/5'),
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-50 dark:bg-amber-950/20 flex items-center justify-center">
                  <Bell className="w-4 h-4 text-amber-500" />
                </div>
                <div>
                  <p className="text-sm font-medium">{t.settingsNotifications ?? '通知'}</p>
                  <p className={cn('text-xs', cls('text-gray-500', 'text-zinc-400'))}>
                    {notificationsEnabled ? '已开启' : '已关闭'}
                  </p>
                </div>
              </div>
              <Switch
                checked={notificationsEnabled}
                onCheckedChange={(checked) => {
                  setNotificationsEnabled(checked);
                  toast.info(checked ? '通知已开启' : '通知已关闭');
                }}
              />
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
