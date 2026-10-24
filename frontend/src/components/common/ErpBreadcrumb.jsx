import { Box, Button, Group, Text } from '@mantine/core';
import { IconFilter } from '@tabler/icons-react';
import classes from '../../styles/pages/InboundSearch.module.css';

export default function ErpBreadcrumb({ parent, current, filterOpen, onOpenFilters }) {
  return (
    <Box component="nav" aria-label="현재 위치" className={classes.pageBreadcrumb}>
      <Group className={classes.breadcrumbTrail} gap={7}>
        <Text component="span" className={classes.breadcrumbParent}>{parent}</Text>
        <Text component="span" className={classes.breadcrumbChevron}>›</Text>
        <Text component="span" className={classes.breadcrumbCurrent}>{current}</Text>
      </Group>
      {!filterOpen && onOpenFilters && (
        <Button className={classes.filterToggle} variant="subtle" size="xs" leftSection={<IconFilter size={15} />} onClick={onOpenFilters}>
          조회조건
        </Button>
      )}
    </Box>
  );
}
