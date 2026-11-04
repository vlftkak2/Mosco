import { useRef, useState } from 'react';
import { IconCalendar } from '@tabler/icons-react';
import { TextInput } from '@mantine/core';
import classes from './ErpDateInput.module.css';

const splitDate = (value) => {
  const parts = String(value || '').split('-');
  return [parts[0] || '', parts[1] || '', parts[2] || ''].map((part) => part.replace(/\D/g, ''));
};

const formatParts = (parts) => {
  const [year, month, day] = parts;
  if (!year) return '';
  const yearText = year;
  const monthText = month || 'MM';
  const dayText = day || 'DD';
  return `${yearText}-${monthText}-${dayText}`;
};

const isValidDate = ([year, month, day]) => {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month) || !/^\d{2}$/.test(day)) return false;
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const candidate = new Date(0);
  candidate.setFullYear(y, m - 1, d);
  candidate.setHours(0, 0, 0, 0);
  return m >= 1 && m <= 12 && d >= 1 && candidate.getFullYear() === y && candidate.getMonth() === m - 1 && candidate.getDate() === d;
};

const segmentRange = (index) => [[0, 4], [5, 7], [8, 10]][index];

export default function ErpDateInput({
  value = '',
  onChange,
  onKeyDown,
  onFocus,
  onClick,
  onBlur,
  label,
  disabled,
  required,
  'aria-label': ariaLabel,
  ...props
}) {
  const controlledValue = value || '';
  const [localDraft, setLocalDraft] = useState({ source: controlledValue, text: controlledValue });
  const draft = localDraft.source === controlledValue ? localDraft.text : controlledValue;
  const inputRef = useRef(null);
  const pickerRef = useRef(null);
  const segmentRef = useRef(0);
  const typedSegmentRef = useRef({ index: -1, text: '' });
  const setDraft = (nextDraft) => setLocalDraft({ source: controlledValue, text: nextDraft });

  const notify = (nextValue) => {
    if (nextValue === controlledValue) return;
    const target = { value: nextValue };
    onChange?.({ currentTarget: target, target });
  };

  const focusSegment = (index) => {
    segmentRef.current = index;
    typedSegmentRef.current = { index, text: '' };
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    const [start, end] = segmentRange(index);
    const length = input.value.length;
    input.setSelectionRange(Math.min(start, length), Math.min(end, length));
  };

  const commitParts = (parts) => {
    const nextDraft = formatParts(parts);
    setDraft(nextDraft);
    if (isValidDate(parts)) notify(parts.join('-'));
    else if (!nextDraft) notify('');
  };

  const enterDigit = (digit) => {
    const index = segmentRef.current;
    const parts = splitDate(draft);
    let typed = typedSegmentRef.current;
    if (typed.index !== index) typed = { index, text: '' };
    const maxLength = index === 0 ? 4 : 2;
    let nextPart = `${typed.text}${digit}`.slice(0, maxLength);
    let completed = nextPart.length === maxLength;

    if (index === 1 && nextPart.length === 1 && Number(nextPart) >= 2) {
      nextPart = `0${nextPart}`;
      completed = true;
    } else if (index === 2 && nextPart.length === 1 && Number(nextPart) >= 4) {
      nextPart = `0${nextPart}`;
      completed = true;
    }
    if (index === 1 && nextPart.length === 2 && (Number(nextPart) < 1 || Number(nextPart) > 12)) completed = false;
    if (index === 2 && nextPart.length === 2 && (Number(nextPart) < 1 || Number(nextPart) > 31)) completed = false;

    parts[index] = nextPart;
    typedSegmentRef.current = { index, text: completed ? '' : nextPart };
    commitParts(parts);

    if (completed && index < 2) {
      const nextIndex = index + 1;
      segmentRef.current = nextIndex;
      typedSegmentRef.current = { index: nextIndex, text: '' };
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        const [start, end] = segmentRange(nextIndex);
        input.setSelectionRange(start, end);
      });
    } else {
      requestAnimationFrame(() => {
        const input = inputRef.current;
        if (!input) return;
        const [start] = segmentRange(index);
        input.setSelectionRange(Math.min(start + nextPart.length, input.value.length), Math.min(start + nextPart.length, input.value.length));
      });
    }
  };

  const handleChange = (event) => {
    // Permit paste of a complete ISO date; normal typing is handled per segment below.
    const pasted = event.currentTarget.value;
    const parts = splitDate(pasted);
    if (isValidDate(parts)) {
      setDraft(pasted);
      notify(pasted);
      segmentRef.current = 0;
      typedSegmentRef.current = { index: -1, text: '' };
    }
  };

  const handleKeyDown = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented) return;

    if (/^\d$/.test(event.key)) {
      event.preventDefault();
      enterDigit(event.key);
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      return;
    }

    if (event.key === 'ArrowRight') {
      const index = segmentRef.current;
      const [, end] = segmentRange(index);
      if ((inputRef.current?.selectionStart ?? 0) >= end && index < 2) {
        event.preventDefault();
        focusSegment(index + 1);
      }
    } else if (event.key === 'ArrowLeft') {
      const index = segmentRef.current;
      const [start] = segmentRange(index);
      if ((inputRef.current?.selectionStart ?? 0) <= start && index > 0) {
        event.preventDefault();
        focusSegment(index - 1);
      }
    } else if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      const parts = splitDate(draft);
      parts[segmentRef.current] = '';
      typedSegmentRef.current = { index: segmentRef.current, text: '' };
      commitParts(parts);
      requestAnimationFrame(() => {
        const [start, end] = segmentRange(segmentRef.current);
        inputRef.current?.setSelectionRange(Math.min(start, inputRef.current.value.length), Math.min(end, inputRef.current.value.length));
      });
    }
  };

  const chooseDate = (event) => {
    const nextValue = event.currentTarget.value;
    setDraft(nextValue);
    notify(nextValue);
    typedSegmentRef.current = { index: -1, text: '' };
  };

  return (
    <TextInput
      {...props}
      ref={inputRef}
      label={label}
      required={required}
      aria-label={ariaLabel}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="YYYY-MM-DD"
      value={draft}
      disabled={disabled}
      className={`${classes.dateInput} ${props.className || ''}`}
      rightSection={(
        <span className={classes.calendarSlot}>
          <IconCalendar size={14} className={classes.calendarIcon} />
          <input
            ref={pickerRef}
            className={classes.calendarPicker}
            type="date"
            value={value || ''}
            disabled={disabled}
            tabIndex={-1}
            aria-hidden="true"
            onChange={chooseDate}
          />
        </span>
      )}
      rightSectionWidth={28}
      rightSectionPointerEvents="all"
      onFocus={(event) => {
        onFocus?.(event);
        const index = segmentRef.current;
        const [start, end] = segmentRange(index);
        event.currentTarget.setSelectionRange(Math.min(start, event.currentTarget.value.length), Math.min(end, event.currentTarget.value.length));
      }}
      onClick={(event) => {
        onClick?.(event);
        const position = event.currentTarget.selectionStart || 0;
        const index = position < 5 ? 0 : position < 8 ? 1 : 2;
        segmentRef.current = index;
        typedSegmentRef.current = { index, text: '' };
      }}
      onChange={handleChange}
      onKeyDown={handleKeyDown}
      onBlur={(event) => {
        onBlur?.(event);
        if (!isValidDate(splitDate(draft))) setDraft(value || '');
        segmentRef.current = 0;
        typedSegmentRef.current = { index: -1, text: '' };
      }}
    />
  );
}
