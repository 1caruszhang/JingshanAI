import { LayoutDashboard, Settings, FileText, BookOpen, Globe, ChevronRight, Plus, ChevronDown, X, PanelLeftClose, Trash2, HelpCircle, Sparkles, Database } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { toast } from '@/lib/toast';
import { cn } from '../../lib/utils';
import { Skeleton } from '@/components/ui/skeleton';
import { useTheme } from '../../hooks/use-theme';
import { useEffect, useState } from 'react';
import { projectService } from '../../services/projectService';
import { useAppState } from '../../context/AppStateContext';
import { useView } from '../../context/ViewContext';
import type { Project, View } from '../../types/domain';
import SettingsDialog from './SettingsDialog';

interface SidebarProps {
  activeView: View;
  onNavigate: (view: View) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
}

const mainMenu: { id: View; icon: React.ComponentType<{ className?: string }>; labelKey: 'dashboard' | 'contentDashboard' | 'aiAgent' | 'autoLearning' | 'aiWebBuilder' }[] = [
  { id: 'dashboard', icon: LayoutDashboard, labelKey: 'dashboard' },
  { id: 'contentDashboard', icon: Database, labelKey: 'contentDashboard' },
  { id: 'aiAgent', icon: Settings, labelKey: 'aiAgent' },
  { id: 'autoLearning', icon: BookOpen, labelKey: 'autoLearning' },
  { id: 'aiWebBuilder', icon: Globe, labelKey: 'aiWebBuilder' },
];

const contentMenu: { id: View; icon: React.ComponentType<{ className?: string }>; labelKey: 'questionPool' | 'sourceDiscovery' | 'articleGeneration' | 'drafts' }[] = [
  { id: 'questionPool', icon: HelpCircle, labelKey: 'questionPool' },
  { id: 'sourceDiscovery', icon: Globe, labelKey: 'sourceDiscovery' },
  { id: 'articleGeneration', icon: Sparkles, labelKey: 'articleGeneration' },
  { id: 'drafts', icon: FileText, labelKey: 'drafts' },
];

export default function Sidebar({ activeView, onNavigate, collapsed, onToggleCollapse, mobileOpen, onCloseMobile }: SidebarProps) {
  const { t, cls, lang } = useTheme();
  const { currentProject, setCurrentProject, refreshProjects, triggerRefreshProjects } = useAppState();
  const { navigateTo, viewParams } = useView();
  const [projects, setProjects] = useState<Project[]>([]);
  const [loadingProjects, setLoadingProjects] = useState(true);
  const [isTeamsExpanded, setIsTeamsExpanded] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectToDelete, setProjectToDelete] = useState<Project | null>(null);
  const [blockedProject, setBlockedProject] = useState<{project: Project; count: number} | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteClick = async (project: Project) => {
    try {
      const {count} = await projectService.canDelete(project.id);
      if (count > 0) {
        setBlockedProject({project, count});
      } else {
        setProjectToDelete(project);
      }
    } catch (err) {
      toast.error(t.deleteProjectFailed ?? '删除检查失败', err instanceof Error ? err.message : undefined);
    }
  };

  const handleConfirmDelete = async () => {
    if (!projectToDelete) return;
    setIsDeleting(true);
    try {
      await projectService.delete(projectToDelete.id);
      if (currentProject?.id === projectToDelete.id) {
        setCurrentProject(null);
      }
      if (activeView === 'kbIngest' && viewParams.projectId === projectToDelete.id) {
        navigateTo('dashboard');
      }
      triggerRefreshProjects();
      setProjectToDelete(null);
    } catch (err) {
      toast.error(t.deleteProjectFailed ?? '删除失败', err instanceof Error ? err.message : undefined);
    } finally {
      setIsDeleting(false);
    }
  };

  useEffect(() => {
    setLoadingProjects(true);
    projectService.getAll().then((data) => {
      setProjects(data);
      setLoadingProjects(false);
    });
  }, [refreshProjects]);

  const handleProjectClick = (project: Project) => {
    setCurrentProject(project);
    navigateTo('kbIngest', { projectId: project.id });
  };

  const handleAddProject = () => {
    navigateTo('kbCreate', {reset: true});
  };

  const handleToggleTeams = () => {
    setIsTeamsExpanded((v) => !v);
  };

  const handleNavigate = (id: View) => {
    onNavigate(id);
    onCloseMobile();
  };

  return (
    <>
      {/* Mobile overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 xl:hidden"
          onClick={onCloseMobile}
        />
      )}

      <aside
        className={cn(
          'fixed xl:static top-10 xl:top-0 inset-y-0 left-0 z-50 h-full shrink-0 flex flex-col transition-all duration-300 ease-in-out border-r',
          cls('bg-[#f5f6f8] border-gray-200/50', 'bg-[#18181c] border-zinc-800/50'),
          collapsed ? 'xl:w-[88px] xl:px-3' : 'xl:w-[260px] xl:px-6',
          'w-[280px] px-6 py-8 xl:py-10',
          mobileOpen ? 'translate-x-0' : '-translate-x-full xl:translate-x-0'
        )}
      >
        {/* Logo + collapse */}
        <div
          className={cn(
            'flex items-center mb-10 px-2 transition-colors duration-300 relative',
            collapsed ? 'xl:justify-center xl:flex-col xl:gap-8' : 'justify-between'
          )}
        >
          <div className="flex items-center gap-3">
            <img
              src="/logo.png"
              alt="鲸杉Agent"
              draggable={false}
              className="w-8 h-8 object-contain shrink-0"
            />
            <div className={cn('flex items-start transition-all duration-300', cls('text-gray-900', 'text-white'))}>
              <span
                className={cn(
                  'font-black tracking-tight transition-all duration-300',
                  collapsed ? 'hidden xl:hidden' : 'text-[18px]'
                )}
                style={{ fontFamily: 'system-ui, sans-serif' }}
              >
                鲸杉Agent
              </span>
            </div>
          </div>

          <button
            aria-label={t.closeMenu ?? 'Close menu'}
            className={cn(
              'xl:hidden p-2 rounded-full shrink-0',
              cls('hover:bg-gray-200/50 text-gray-700', 'hover:bg-zinc-800 text-zinc-300')
            )}
            onClick={onCloseMobile}
          >
            <X className="w-5 h-5" />
          </button>

          <button
            aria-label={collapsed ? (t.expandSidebar ?? 'Expand sidebar') : (t.collapseSidebar ?? 'Collapse sidebar')}
            className={cn(
              'hidden xl:flex p-1.5 shrink-0 rounded-lg transition-colors shadow-xs absolute -right-[36px]',
              cls(
                'text-gray-400 border border-gray-200/60 hover:text-black bg-white hover:bg-gray-50',
                'text-gray-300 border border-zinc-700/80 hover:text-white bg-[#27272a] hover:bg-[#343438]'
              )
            )}
            onClick={onToggleCollapse}
          >
            {collapsed ? (
              <ChevronRight className="w-3.5 h-3.5" />
            ) : (
              <PanelLeftClose className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        <div className="flex-1 flex flex-col gap-8 min-h-0">
          {/* Main menu */}
          <div className="shrink-0">
            <h3
              className={cn(
                'text-[12px] font-medium mb-4 px-4 transition-colors duration-300 text-gray-500',
                collapsed ? 'xl:hidden' : ''
              )}
            >
              {lang === 'zh' ? '主菜单' : 'Main Menu'}
            </h3>
            <nav className="flex flex-col gap-1">
              {mainMenu.map(({ id, icon: Icon, labelKey }) => (
                <button
                  key={id}
                  onClick={() => handleNavigate(id)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 w-full rounded-2xl font-bold text-[14px] transition-colors',
                    activeView === id
                      ? cls(
                          'bg-white shadow-xs border border-gray-200/50 text-gray-900',
                          'bg-[#1c1c1f] border border-white/5 text-white'
                        )
                      : cls(
                          'border border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50',
                          'border border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                        )
                  )}
                >
                  <Icon className="w-[18px] h-[18px] shrink-0" />
                  <span className={cn('truncate text-left flex-1', collapsed ? 'xl:hidden' : 'block')}>
                    {t[labelKey]}
                  </span>
                </button>
              ))}
            </nav>
          </div>

          {/* Content production menu */}
          <div className="shrink-0">
            <h3
              className={cn(
                'text-[12px] font-medium mb-4 px-4 transition-colors duration-300 text-gray-500',
                collapsed ? 'xl:hidden' : ''
              )}
            >
              {t.contentSection ?? '内容生产'}
            </h3>
            <nav className="flex flex-col gap-1">
              {contentMenu.map(({ id, icon: Icon, labelKey }) => (
                <button
                  key={id}
                  onClick={() => handleNavigate(id)}
                  className={cn(
                    'flex items-center gap-3 px-3 py-2.5 w-full rounded-2xl font-bold text-[14px] transition-colors',
                    activeView === id
                      ? cls(
                          'bg-white shadow-xs border border-gray-200/50 text-gray-900',
                          'bg-[#1c1c1f] border border-white/5 text-white'
                        )
                      : cls(
                          'border border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50',
                          'border border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                        )
                  )}
                >
                  <Icon className="w-[18px] h-[18px] shrink-0" />
                  <span className={cn('truncate text-left flex-1', collapsed ? 'xl:hidden' : 'block')}>
                    {t[labelKey]}
                  </span>
                </button>
              ))}
            </nav>
          </div>

          {/* Enterprise section */}
          <div className={cn('flex-1 min-h-0 flex flex-col', collapsed ? 'xl:hidden' : '')}>
            {/* Header with expand/collapse */}
            <div
              onClick={handleToggleTeams}
              aria-label={isTeamsExpanded ? (t.collapseTeams ?? 'Collapse team list') : (t.expandTeams ?? 'Expand team list')}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggleTeams(); } }}
              className={cn(
                'shrink-0 cursor-pointer select-none flex items-center justify-between px-3.5 py-1.5 rounded-[14px] border transition-all mb-3',
                cls(
                  'bg-gray-100 hover:bg-gray-200/50 border-gray-200/20 text-gray-900 shadow-xs',
                  'bg-white/[0.04] hover:bg-white/[0.07] border-white/5 text-white'
                )
              )}
            >
              <div className="flex items-center gap-2">
                <ChevronDown
                  className={cn(
                    'w-3.5 h-3.5 text-gray-500 dark:text-gray-400 transition-transform duration-300',
                    isTeamsExpanded ? '' : '-rotate-90'
                  )}
                />
                <span className="text-[13px] font-extrabold tracking-tight">{t.knowledgeBaseTitle}</span>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); handleAddProject(); }}
                aria-label={t.addProject ?? 'Add project'}
                className={cn(
                  'w-6 h-6 rounded-full flex items-center justify-center transition-all',
                  cls(
                    'bg-white text-gray-800 hover:text-black border border-gray-200/30 hover:bg-gray-50 shadow-xs',
                    'bg-[#27272a] text-gray-300 hover:text-white border border-white/5 hover:bg-zinc-700'
                  )
                )}
              >
                <Plus className="w-3 h-3 stroke-[2.5]" />
              </button>
            </div>

            {/* Projects list */}
            {isTeamsExpanded && (
              <div
                className="overflow-y-auto min-h-0 flex-1 mt-2"
                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
              >
                {loadingProjects ? (
                  <div className="px-3 space-y-2">
                    <Skeleton className="h-8 w-full" />
                    <Skeleton className="h-8 w-full" />
                  </div>
                ) : (
                  <nav className="flex flex-col gap-1 pb-4">
                    {projects.map((project) => (
                      <div key={project.id} className="relative group">
                        <button
                          onClick={() => handleProjectClick(project)}
                          className={cn(
                            'flex items-center gap-3 px-3 py-2.5 pr-10 w-full rounded-2xl font-bold text-[14px] transition-colors',
                            currentProject?.id === project.id
                              ? cls(
                                  'bg-white shadow-xs border border-gray-200/50 text-gray-900',
                                  'bg-[#1c1c1f] border border-white/5 text-white'
                                )
                              : cls(
                                  'border border-transparent text-gray-500 hover:text-gray-800 hover:bg-gray-50',
                                  'border border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                                )
                          )}
                        >
                          <BookOpen className="w-4 h-4 shrink-0" />
                          <span className={cn('truncate text-left flex-1', collapsed ? 'xl:hidden' : 'block')}>
                            {project.name}
                          </span>
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleDeleteClick(project); }}
                          aria-label={`${t.deleteProject} ${project.name}`}
                          className={cn(
                            'absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity',
                            cls('hover:bg-red-50 text-red-500', 'hover:bg-red-950/20 text-red-400')
                          )}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                    {projects.length === 0 && (
                      <p className={cn('px-3 text-xs', cls('text-gray-400', 'text-zinc-500'))}>
                        {t.noProjectsDesc}
                      </p>
                    )}
                  </nav>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-auto pt-8 flex flex-col gap-1">
          <button
            onClick={() => setSettingsOpen(true)}
            className={cn(
              'flex items-center gap-3 px-3 py-2.5 w-full rounded-2xl font-bold text-[14px] transition-colors',
              cls('text-gray-500 hover:bg-gray-50', 'text-gray-400 hover:bg-white/5')
            )}
          >
            <Settings className="w-[18px] h-[18px]" />
            <span className={cn(collapsed ? 'xl:hidden' : 'block')}>{t.settings}</span>
          </button>
        </div>
      </aside>

      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />

      {/* 确认删除弹窗 */}
      <Dialog open={!!projectToDelete} onOpenChange={(open) => { if (!open) setProjectToDelete(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t.deleteProject}</DialogTitle>
            <DialogDescription>
              {projectToDelete ? t.deleteProjectConfirm.replace('{name}', projectToDelete.name) : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setProjectToDelete(null)} disabled={isDeleting}>
              {t.cancel}
            </Button>
            <Button variant="destructive" onClick={handleConfirmDelete} disabled={isDeleting}>
              {isDeleting ? '...' : t.delete}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 阻塞提示弹窗 */}
      <Dialog open={!!blockedProject} onOpenChange={(open) => { if (!open) setBlockedProject(null); }}>
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t.deleteProjectBlocked}</DialogTitle>
            <DialogDescription>
              {blockedProject ? t.deleteProjectBlockedDesc.replace('{count}', String(blockedProject.count)) : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setBlockedProject(null)}>
              {t.gotIt}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
