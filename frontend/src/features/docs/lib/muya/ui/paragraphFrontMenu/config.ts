import type Parent from '../../block/base/parent';
import type {
    IQuickInsertMenuItem,
} from '../paragraphQuickInsertMenu/config';
import { canTurnInto } from '../../block/blockTransforms';
import { isOsx } from '../../config';
import { lucideIcons } from '../../utils/icons';
import {
    MENU_CONFIG,
} from '../paragraphQuickInsertMenu/config';

const ALL_MENU_CONFIG = MENU_CONFIG.reduce(
    (acc, section) => [...acc, ...section.children],
    [] as IQuickInsertMenuItem['children'],
);

const COMMAND_KEY = isOsx ? '⌘' : '⌃';

export const FRONT_MENU = [
    {
        icon: lucideIcons.copy,
        label: 'duplicate',
        text: 'Duplicate',
        shortCut: `⇧${COMMAND_KEY}P`,
    },
    {
        icon: lucideIcons.paragraph,
        label: 'new',
        text: 'New Paragraph',
        shortCut: `⇧${COMMAND_KEY}N`,
    },
    {
        icon: lucideIcons.delete,
        label: 'delete',
        text: 'Delete',
        shortCut: `⇧${COMMAND_KEY}D`,
    },
];

export type FrontMenuIcon = (typeof FRONT_MENU)[number];

export function canTurnIntoMenu(block: Parent) {
    return ALL_MENU_CONFIG.filter(item => canTurnInto(block, item.label));
}
