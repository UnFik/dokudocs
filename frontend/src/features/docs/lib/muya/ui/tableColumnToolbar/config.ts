import { lucideIcons } from '../../utils/icons';

const icons = [
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
        type: 'insert left',
        tooltip: 'Insert Column left',
        icon: lucideIcons.insertColLeft,
    },
    {
        type: 'insert right',
        tooltip: 'Insert Column right',
        icon: lucideIcons.insertColRight,
    },
    {
        type: 'remove',
        tooltip: 'Remove Column',
        icon: lucideIcons.removeCol,
    },
];

export type TableColumnToolIcon = typeof icons[number];

export default icons;
