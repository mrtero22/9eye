// Admin → Users: the people of this company, their companies and roles (decision 0007).

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, errorText } from '@/lib/api';
import { keys } from '@/lib/queries';
import type { AdminCompany, AdminUser, Role } from '@/lib/types';
import { Avatar, Button, ConfirmDialog, Dialog, IconButton, Menu, MenuItem, MenuSeparator, Notice, SectionHead, SelectField, Table, TableRow, TextField, useToast } from '@/ui';

const COLUMNS = 'minmax(220px, 1.3fr) minmax(260px, 2fr) 72px 120px 36px';

function lastActive(u: AdminUser): { text: string; amber: boolean } {
  if (u.status === 'invited') return { text: 'Invited', amber: true };
  if (!u.lastActiveAt) return { text: 'Never', amber: false };
  const d = new Date(u.lastActiveAt);
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days === 0) return { text: `Today ${d.toTimeString().slice(0, 5)}`, amber: false };
  if (days === 1) return { text: 'Yesterday', amber: false };
  return { text: `${days} days ago`, amber: false };
}

export function UsersSection() {
  const qc = useQueryClient();
  const toast = useToast();
  const users = useQuery({ queryKey: keys.users(), queryFn: () => api<AdminUser[]>('GET', '/admin/users') });
  const roles = useQuery({ queryKey: keys.roles(), queryFn: () => api<Role[]>('GET', '/admin/roles') });
  const companies = useQuery({ queryKey: keys.companies(), queryFn: () => api<AdminCompany[]>('GET', '/admin/companies') });
  const company = companies.data?.find((c) => c.current)?.name ?? 'this company';
  const [inviting, setInviting] = useState(false);
  const [changing, setChanging] = useState<AdminUser | null>(null);
  const [removing, setRemoving] = useState<AdminUser | null>(null);
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: keys.users() });
    void qc.invalidateQueries({ queryKey: keys.roles() });
  };
  const remove = useMutation({
    mutationFn: (u: AdminUser) => api('DELETE', `/admin/users/${u.id}`),
    onSuccess: (_r, u) => {
      refresh();
      toast(`${u.name} removed from ${company}`);
    },
    onError: (e) => toast(errorText(e), 'red'),
  });
  const companyRoles = (roles.data ?? []).filter((r) => r.id !== 'platform-admin');
  return (
    <>
      <SectionHead title="Users" description="People, their companies and roles">
        <Button variant="primary" icon="plus" onClick={() => setInviting(true)}>
          Invite user
        </Button>
      </SectionHead>
      {users.error && <Notice tone="red">{errorText(users.error)}</Notice>}
      <Table columns={COLUMNS} head={['User', 'Companies and roles', 'MFA', 'Last active', '']}>
        {(users.data ?? []).map((u) => {
          const last = lastActive(u);
          return (
            <TableRow key={u.id}>
              <span className="flex min-w-0 items-center gap-3">
                <Avatar name={u.name} />
                <span className="flex min-w-0 flex-col leading-[1.35]">
                  <span className="font-medium">{u.name}</span>
                  <span className="truncate text-small text-text-3">{u.email}</span>
                </span>
              </span>
              <span className="flex flex-col gap-0.5 text-small">
                {u.memberships.map((m) => (
                  <span key={m.company}>
                    <span className="font-medium">{m.company}</span>
                    <span className="text-text-3"> · {m.role}</span>
                  </span>
                ))}
                {u.platformAdmin && <span className="text-text-3">Platform admin</span>}
              </span>
              <span className={u.mfaEnabled ? 'text-small text-text-2' : 'text-small text-amber-text'}>{u.mfaEnabled ? 'On' : 'Off'}</span>
              <span className={last.amber ? 'text-small text-amber-text' : 'text-small text-text-2'}>{last.text}</span>
              <Menu label={`Actions for ${u.name}`} width={220} trigger={<IconButton icon="more" label={`Actions for ${u.name}`} tone="quiet" />}>
                <MenuItem onSelect={() => setChanging(u)}>Change role…</MenuItem>
                <MenuSeparator />
                <MenuItem danger onSelect={() => setRemoving(u)}>
                  Remove from {company}…
                </MenuItem>
              </Menu>
            </TableRow>
          );
        })}
      </Table>
      <div className="text-small text-text-3">Sign-in and two-step verification come later; until then invited people cannot log in.</div>
      <InviteDialog open={inviting} onOpenChange={setInviting} roles={companyRoles} onDone={refresh} />
      <ChangeRoleDialog user={changing} onOpenChange={(o) => !o && setChanging(null)} roles={companyRoles} onDone={refresh} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name ?? ''} from ${company}?`}
        description="They keep their other companies. The company always keeps at least one company admin."
        confirmLabel="Remove"
        danger
        onConfirm={() => {
          if (removing) remove.mutate(removing);
          setRemoving(null);
        }}
      />
    </>
  );
}

function InviteDialog({ open, onOpenChange, roles, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; roles: Role[]; onDone: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const role = roleId || roles.find((r) => r.name === 'Viewer')?.id || roles[0]?.id || '';
  const m = useMutation({
    mutationFn: () => api('POST', '/admin/users', { name, email, roleId: role }),
    onSuccess: () => {
      toast(`${name} invited`);
      onOpenChange(false);
      setName('');
      setEmail('');
      setError(null);
      onDone();
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Invite user"
      description="The person gets a role in this company. If they already work for another company, it is the same login."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!name.trim() || !email.trim() || !role || m.isPending} onClick={() => m.mutate()}>
            Invite
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} autoFocus onChange={(e) => setName(e.target.value)} />
      <TextField label="E-mail" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      <SelectField label="Role" value={role} onChange={(e) => setRoleId(e.target.value)}>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </SelectField>
      {error && <Notice tone="amber">{error}</Notice>}
    </Dialog>
  );
}

function ChangeRoleDialog({ user, onOpenChange, roles, onDone }: { user: AdminUser | null; onOpenChange: (o: boolean) => void; roles: Role[]; onDone: () => void }) {
  const toast = useToast();
  const [roleId, setRoleId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const role = roleId || user?.roleId || '';
  const m = useMutation({
    mutationFn: () => api('PATCH', `/admin/users/${user!.id}`, { roleId: role }),
    onSuccess: () => {
      toast('Role changed');
      setRoleId('');
      setError(null);
      onOpenChange(false);
      onDone();
    },
    onError: (e) => setError(errorText(e)),
  });
  return (
    <Dialog
      open={!!user}
      onOpenChange={(o) => {
        if (!o) {
          setRoleId('');
          setError(null);
        }
        onOpenChange(o);
      }}
      title={`Role of ${user?.name ?? ''}`}
      description="In this company only."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!role || role === user?.roleId || m.isPending} onClick={() => m.mutate()}>
            Change role
          </Button>
        </>
      }
    >
      <SelectField label="Role" value={role} onChange={(e) => setRoleId(e.target.value)}>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>
            {r.name}
          </option>
        ))}
      </SelectField>
      {error && <Notice tone="amber">{error}</Notice>}
    </Dialog>
  );
}
