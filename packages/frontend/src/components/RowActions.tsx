import type { ReactNode } from 'react'
import { Button, Dropdown, Modal, Popconfirm, Space, Tooltip } from 'antd'
import { MenuOutlined } from '@ant-design/icons'

export type RowAction = {
  key: string
  label: string
  icon: ReactNode
  danger?: boolean
  disabled?: boolean
  confirm?: { title: string; description?: string; okText: string }
  onClick: () => void | Promise<unknown>
}

/** Icon buttons for up to two actions; a hamburger menu beyond that, or always with `menu`. */
export default function RowActions({ actions, menu = false }: { actions: RowAction[]; menu?: boolean }) {
  if (actions.length === 0) return null
  // Rows and card headers are clickable, so clicks on the actions must not reach them
  const stop = (e: { stopPropagation: () => void }) => e.stopPropagation()

  if (menu || actions.length > 2) {
    return (
      <span onClick={stop}>
        <Dropdown
          trigger={['click']}
          menu={{
            items: actions.map((a) => ({ key: a.key, label: a.label, icon: a.icon, danger: a.danger, disabled: a.disabled })),
            onClick: ({ key, domEvent }) => {
              domEvent.stopPropagation()
              const a = actions.find((x) => x.key === key)
              if (!a) return
              if (a.confirm) {
                Modal.confirm({ title: a.confirm.title, content: a.confirm.description, okText: a.confirm.okText, okButtonProps: { danger: a.danger }, onOk: a.onClick })
              } else {
                void a.onClick()
              }
            },
          }}
        >
          <Button size="small" type="text" icon={<MenuOutlined />} />
        </Dropdown>
      </span>
    )
  }

  return (
    <Space size={0} onClick={stop}>
      {actions.map((a) => {
        const button = (
          <Tooltip title={a.label}>
            <Button size="small" type="text" danger={a.danger} icon={a.icon} disabled={a.disabled} onClick={a.confirm ? undefined : () => void a.onClick()} />
          </Tooltip>
        )
        return a.confirm
          ? (
            <Popconfirm key={a.key} title={a.confirm.title} description={a.confirm.description} okText={a.confirm.okText} okType={a.danger ? 'danger' : 'primary'} disabled={a.disabled} onConfirm={a.onClick}>
              {button}
            </Popconfirm>
          )
          : <span key={a.key}>{button}</span>
      })}
    </Space>
  )
}
