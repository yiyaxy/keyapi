import React, { useState } from 'react';
import { Card, Space } from '@douyinfe/semi-ui';
import { useTranslation } from 'react-i18next';
import { useTenantMembersData } from './useTenantMembersData';
import TenantMembersActions from './TenantMembersActions';
import TenantMembersFilters from './TenantMembersFilters';
import TenantMembersTable from './TenantMembersTable';
import InviteMemberModal from './modals/InviteMemberModal';
import EditMemberRoleModal from './modals/EditMemberRoleModal';

export default function TenantMembers() {
  const { t } = useTranslation();
  const {
    items,
    total,
    page,
    pageSize,
    keyword,
    statusFilter,
    loading,
    setPage,
    setKeyword,
    setStatusFilter,
    reload,
    invite,
    updateRoleOrStatus,
    remove,
  } = useTenantMembersData();

  const [inviteOpen, setInviteOpen] = useState(false);
  const [editTarget, setEditTarget] = useState(null);

  return (
    <div style={{ padding: 16 }}>
      <Card title={t('租户成员')}>
        <Space vertical align='start' style={{ width: '100%' }}>
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              width: '100%',
              flexWrap: 'wrap',
              gap: 8,
            }}
          >
            <TenantMembersFilters
              keyword={keyword}
              onKeywordChange={setKeyword}
              statusFilter={statusFilter}
              onStatusFilterChange={setStatusFilter}
            />
            <TenantMembersActions
              onInviteClick={() => setInviteOpen(true)}
              onRefresh={reload}
            />
          </div>
          <TenantMembersTable
            items={items}
            loading={loading}
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onEditClick={(row) => setEditTarget(row)}
            onRemoveClick={(row) => remove(row.user_id)}
          />
        </Space>
      </Card>
      <InviteMemberModal
        visible={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onInvite={invite}
      />
      <EditMemberRoleModal
        visible={!!editTarget}
        member={editTarget}
        onClose={() => setEditTarget(null)}
        onSubmit={updateRoleOrStatus}
      />
    </div>
  );
}
