import { lucideIcons } from '../../utils/icons'

const icons = [
  {
    type: 'edit',
    tooltip: 'Edit Image',
    icon: lucideIcons.imageEdit,
  },
  {
    type: 'inline',
    tooltip: 'Inline Image',
    icon: lucideIcons.imageInline,
  },
  {
    type: 'left',
    tooltip: 'Align Left',
    icon: lucideIcons.alignLeft,
  },
  {
    type: 'center',
    tooltip: 'Align Center',
    icon: lucideIcons.alignCenter,
  },
  {
    type: 'right',
    tooltip: 'Align Right',
    icon: lucideIcons.alignRight,
  },
  {
    type: 'delete',
    tooltip: 'Remove Image',
    icon: lucideIcons.imageDelete,
  },
]

export default icons

export type Icon = (typeof icons)[number]
