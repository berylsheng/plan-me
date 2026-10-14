import React, { useEffect, useState, useCallback, useRef, useMemo, useContext, createContext } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, KeyboardAvoidingView, Platform, Alert, Pressable, Image, SectionList, Modal, PanResponder } from 'react-native';
import { Calendar, type DateData } from 'react-native-calendars';
import { router, useLocalSearchParams } from 'expo-router';

import { MemberAvatar } from '@/components/events/MemberAvatar';
import { ShareToggle } from '@/components/events/ShareToggle';
import { exampleTagOf, InputTips, placeholderFor } from '@/components/events/InputTips';
import { LegacyImportPrompt } from '@/components/events/LegacyImportPrompt';
import { RefusedNotice, SyncBadge } from '@/components/events/SyncBadge';
import { TagMappingPrompt } from '@/components/family/TagMappingPrompt';
import { useAuth } from '@/context/AuthProvider';
import { useEvents } from '@/context/EventsProvider';
import { useFamily } from '@/context/FamilyProvider';
import { getNZMonthYear, getWeekDays, getWeekRange, toNZDateKey } from '@/lib/dates';
import { newUuid } from '@/lib/events/ids';
import { isDateKey } from '@/lib/events/repeat';
import { draftToEvents } from '@/lib/events/items';
import type { EventRecord, Visibility } from '@/lib/events/rows';
import type { LocalEvent } from '@/lib/events/types';
import { parseEventInput } from '@/lib/parse/parseEventInput';
import { knownTagsFor, memberLabel, withPeople } from '@/lib/family/tags';
import type { Member } from '@/lib/family/types';

type DisplayEvent = LocalEvent & { _isPast: boolean };

const EditModeContext = createContext(false);
const HandlersContext = createContext<{ onEdit: (item: LocalEvent) => void; onDelete: (item: LocalEvent) => void }>({
  onEdit: () => {},
  onDelete: () => {},
});

const MetaContext = createContext<{
  records: Record<string, EventRecord>;
  memberById: ReadonlyMap<string, Member>;
  myId: string | null;
  /** True once the family snapshot has been loaded (me is not null). */
  meKnown: boolean;
}>({ records: {}, memberById: new Map(), myId: null, meKnown: false });

type ViewMode = 'today' | 'week' | 'all';

const PERSON_ICONS: Record<string, number> = {
  AZ: require('../../assets/images/icon_az.png'),
  GS: require('../../assets/images/icon_gs.png'),
};

const CALENDAR_THEME = {
  selectedDayBackgroundColor: '#007BFF',
  todayTextColor: '#007BFF',
  dotColor: '#007BFF',
  arrowColor: '#007BFF',
};

const DAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

const EventItem = React.memo(function EventItem({ item }: { item: DisplayEvent }) {
  const editMode = useContext(EditModeContext);
  const { onEdit, onDelete } = useContext(HandlersContext);
  const { records, memberById, myId, meKnown } = useContext(MetaContext);
  const record = records[item.id];
  const members = (record?.memberIds ?? []).flatMap(id => {
    const member = memberById.get(id);
    return member ? [member] : [];
  });
  const timeDisplay = item.endTime ? `${item.startTime}-${item.endTime}` : item.startTime || '';
  const isPast = item._isPast;
  return (
    <View style={[styles.itemContainer, isPast && styles.itemPast]}>
      <View style={styles.itemContent}>
        {timeDisplay ? <Text style={[styles.itemTime, isPast && styles.textPast]}>{timeDisplay}</Text> : null}
        {members.map(member => <MemberAvatar key={member.id} member={member} faded={isPast} />)}
        {item.people?.map(tag => (
          PERSON_ICONS[tag]
            ? <Image key={tag} source={PERSON_ICONS[tag]} style={[styles.personIcon, isPast && { opacity: 0.4 }]} />
            : <Text key={tag} style={[styles.legacyTag, isPast && styles.textPast]}> @{tag}</Text>
        ))}
        <View style={styles.itemText}>
          <Text style={[styles.itemName, isPast && styles.textPast]}>
            {timeDisplay || item.people?.length || members.length ? ' ' : ''}{item.name}
          </Text>
          {record?.visibility === 'shared' ? (
            <Text style={[styles.sharedLabel, isPast && styles.textPast]}>
              Shared ·{' '}
              {record.ownerId === myId
                ? 'You'
                : !meKnown && record.ownerId
                ? 'Member'
                : memberLabel(record.ownerId ? memberById.get(record.ownerId) : undefined, myId)}
            </Text>
          ) : null}
        </View>
      </View>
      {editMode && (
        <View style={styles.itemActions}>
          <Pressable onPress={() => onEdit(item)} hitSlop={8}>
            <Text style={styles.editText}>Edit</Text>
          </Pressable>
          <Pressable onPress={() => onDelete(item)} hitSlop={8}>
            <Text style={styles.deleteText}>Delete</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
});

export default function App() {
  const { user } = useAuth();
  const { items, records, addEvents, deleteEvents } = useEvents();
  const { me, family, members, memberById, memberByTag } = useFamily();
  const knownTags = useMemo(() => knownTagsFor(members), [members]);
  // The last choice for new events, for this session; starts personal (spec §5).
  const [shareNew, setShareNew] = useState(false);
  const [inputText, setInputText] = useState('');
  const [currentMonth, setCurrentMonth] = useState(() => getNZMonthYear(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => toNZDateKey(new Date()));
  const selectedDateRef = useRef(selectedDate);
  const [editMode, setEditMode] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('today');
  const [showDatePicker, setShowDatePicker] = useState(false);

  // When the signed-in user changes, reset all transient planner state.
  const userId = user?.id ?? null;

  useEffect(() => {
    setShareNew(false);
    setInputText('');
  }, [userId]);

  const selectDate = useCallback((dk: string) => {
    const [y, m, d] = dk.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    setCurrentMonth(getNZMonthYear(date));
    setSelectedDate(dk);
    selectedDateRef.current = dk;
  }, []);

  // A tapped morning summary opens the planner on its day, in the Today view.
  // `at` changes with every tap, so tapping the same day's summary again still brings it back.
  const { date: openOnDate, at: tappedAt } = useLocalSearchParams<{ date?: string; at?: string }>();
  useEffect(() => {
    if (!openOnDate || !isDateKey(openOnDate)) return;
    selectDate(openOnDate);
    setViewMode('today');
  }, [openOnDate, tappedAt, selectDate]);

  const handleDayPress = useCallback((day: DateData) => {
    selectDate(toNZDateKey(new Date(day.year, day.month - 1, day.day)));
  }, [selectDate]);

  const shiftWeek = useCallback((direction: number) => {
    const [y, m, d] = selectedDate.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    date.setDate(date.getDate() + direction * 7);
    selectDate(toNZDateKey(date));
  }, [selectedDate, selectDate]);

  const shiftWeekRef = useRef(shiftWeek);
  shiftWeekRef.current = shiftWeek;

  const weekSwipePanResponder = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, gs) => Math.abs(gs.dx) > 30 && Math.abs(gs.dy) < 30,
    onPanResponderRelease: (_, gs) => {
      if (gs.dx > 50) shiftWeekRef.current(-1);
      else if (gs.dx < -50) shiftWeekRef.current(1);
    },
  }), []);

  // 2. The brain of the app: Parsing the text
  const handleAddTask = () => {
    if (!inputText.trim()) return;

    const result = parseEventInput(inputText, { selectedDateKey: selectedDateRef.current, knownTags });
    if (!result.ok) {
      Alert.alert("Oops!", "I couldn't find a date or time in that sentence.");
      return;
    }

    const seriesId = result.draft.isRecurring ? newUuid() : null;
    const fresh = draftToEvents(result.draft, newUuid, seriesId);
    const visibility: Visibility = family && shareNew ? 'shared' : 'personal';
    addEvents(fresh.map(event => withPeople(event, memberByTag, visibility)));
    setInputText('');
  };

  const deleteSingleItem = useCallback((item: LocalEvent) => {
    deleteEvents([item.id]);
  }, [deleteEvents]);

  const deleteFutureOccurrences = useCallback((item: LocalEvent) => {
    const ids = Object.values(records)
      .filter(r => r.occurrenceId === item.occurrenceId && r.dateKey >= item.dateKey)
      .map(r => r.id);
    deleteEvents(ids);
  }, [records, deleteEvents]);

  const handleDeleteItem = useCallback((item: LocalEvent) => {
    if (item.occurrenceId) {
      Alert.alert('Delete recurring event', `"${item.name}"`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'This event only', onPress: () => deleteSingleItem(item) },
        { text: 'This and all future', style: 'destructive', onPress: () => deleteFutureOccurrences(item) },
      ]);
    } else {
      Alert.alert('Delete', `Delete "${item.name}"?`, [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteSingleItem(item) },
      ]);
    }
  }, [deleteSingleItem, deleteFutureOccurrences]);

  const handleEditItem = useCallback((item: LocalEvent) => {
    router.push({ pathname: '/event/[id]/edit', params: { id: item.id } });
  }, []);

  const todayKey = toNZDateKey(new Date());

  const markedDates = useMemo(() => {
    const marks: Record<string, { marked?: boolean; dotColor?: string; selected?: boolean; selectedColor?: string }> = {};
    for (const dk of Object.keys(items)) {
      marks[dk] = { marked: true, dotColor: '#007BFF' };
    }
    if (selectedDate) {
      marks[selectedDate] = { ...(marks[selectedDate] || {}), selected: true, selectedColor: '#007BFF' };
    }
    return marks;
  }, [items, selectedDate]);

  const eventSections = useMemo(() => {
    const sections: { title: string; dateKey: string; data: DisplayEvent[] }[] = [];
    const addSection = (dk: string) => {
      if (!items[dk] || items[dk].length === 0) return;
      const [y, m, d] = dk.split('-').map(Number);
      const date = new Date(y, m - 1, d);
      const dayName = date.toLocaleDateString('en-NZ', { weekday: 'short' });
      const title = dk === todayKey ? `Today, ${d}/${m}` : `${dayName}, ${d}/${m}`;
      const isPast = dk < todayKey;
      sections.push({
        title,
        dateKey: dk,
        data: items[dk].map(item => ({ ...item, _isPast: isPast })),
      });
    };

    if (viewMode === 'today') {
      addSection(selectedDate);
    } else if (viewMode === 'week') {
      const { start, end } = getWeekRange(selectedDate);
      for (const dk of Object.keys(items).sort()) {
        if (dk >= start && dk <= end) addSection(dk);
      }
    } else {
      for (const dk of Object.keys(items).sort()) {
        if (dk >= todayKey) addSection(dk);
      }
    }
    return sections;
  }, [items, viewMode, selectedDate, todayKey]);

  const meta = useMemo(
    () => ({ records, memberById, myId: userId, meKnown: me !== null }),
    [records, memberById, userId, me],
  );

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Plan-Me</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Settings"
          onPress={() => router.push('/settings')}
          hitSlop={8}
          style={styles.settingsButton}
        >
          <Text style={styles.settingsText}>Settings</Text>
        </Pressable>
      </View>
      <SyncBadge />
      <RefusedNotice />
      <LegacyImportPrompt />
      <TagMappingPrompt />

      {/* Week strip with swipe-by-week */}
      <View style={styles.calendarRow} {...weekSwipePanResponder.panHandlers}>
        <TouchableOpacity style={styles.arrowBtn} onPress={() => shiftWeek(-1)}>
          <Text style={styles.arrowText}>{'<'}</Text>
        </TouchableOpacity>
        <View style={styles.weekStrip}>
          {getWeekDays(selectedDate).map((dayKey, i) => {
            const dayNum = dayKey.split('-')[2];
            const isSelected = dayKey === selectedDate;
            const hasEvents = !!markedDates[dayKey];
            return (
              <TouchableOpacity
                key={dayKey}
                style={[styles.weekDay, isSelected && styles.weekDaySelected]}
                onPress={() => selectDate(dayKey)}
              >
                <Text style={[styles.weekDayLabel, isSelected && styles.weekDayTextSelected]}>{DAY_LABELS[i]}</Text>
                <Text style={[styles.weekDayNum, isSelected && styles.weekDayTextSelected]}>{parseInt(dayNum, 10)}</Text>
                {hasEvents && <View style={[styles.weekDayDot, isSelected && styles.weekDayDotSelected]} />}
              </TouchableOpacity>
            );
          })}
        </View>
        <TouchableOpacity style={styles.arrowBtn} onPress={() => shiftWeek(1)}>
          <Text style={styles.arrowText}>{'>'}</Text>
        </TouchableOpacity>
      </View>

      {/* Tappable month header */}
      <TouchableOpacity style={styles.monthButton} onPress={() => setShowDatePicker(true)}>
        <Text style={styles.monthButtonText}>{currentMonth}</Text>
      </TouchableOpacity>

      {/* Date picker modal */}
      <Modal visible={showDatePicker} transparent animationType="fade">
        <Pressable style={styles.modalOverlay} onPress={() => setShowDatePicker(false)}>
          <View style={styles.modalContent}>
            <Calendar
              current={selectedDate}
              markedDates={markedDates}
              onDayPress={(day) => {
                handleDayPress(day);
                setShowDatePicker(false);
              }}
              theme={CALENDAR_THEME}
              firstDay={1}
            />
          </View>
        </Pressable>
      </Modal>

      <View style={styles.toolbar}>
        <View style={styles.viewModeButtons}>
          {(['today', 'week', 'all'] as ViewMode[]).map(mode => (
            <TouchableOpacity
              key={mode}
              style={[styles.viewModeBtn, viewMode === mode && styles.viewModeBtnActive, editMode && styles.viewModeBtnDisabled]}
              onPress={() => {
                if (!editMode) {
                  setViewMode(mode);
                  if (mode === 'today') {
                    const today = toNZDateKey(new Date());
                    setSelectedDate(today);
                    selectedDateRef.current = today;
                    setCurrentMonth(getNZMonthYear(new Date()));
                  }
                }
              }}
              disabled={editMode}
            >
              <Text style={[styles.viewModeBtnText, viewMode === mode && styles.viewModeBtnTextActive, editMode && styles.disabledText]}>
                {mode.charAt(0).toUpperCase() + mode.slice(1)}
              </Text>
            </TouchableOpacity>
          ))}
        </View>
        <TouchableOpacity onPress={() => setEditMode(prev => !prev)}>
          <Text style={styles.modifyText}>{editMode ? 'Done' : 'Modify'}</Text>
        </TouchableOpacity>
      </View>

      {/* Events list */}
      <MetaContext.Provider value={meta}>
      <EditModeContext.Provider value={editMode}>
      <HandlersContext.Provider value={{ onEdit: handleEditItem, onDelete: handleDeleteItem }}>
      {eventSections.length > 0 ? (
        <SectionList
          sections={eventSections}
          keyExtractor={item => item.id}
          renderItem={({ item }) => <EventItem item={item} />}
          renderSectionHeader={({ section }) => (
            viewMode !== 'today' ? (
              <View style={styles.sectionHeader}>
                <Text style={[styles.sectionHeaderText, section.dateKey < todayKey && styles.textPast]}>{section.title}</Text>
              </View>
            ) : null
          )}
          style={styles.eventList}
          stickySectionHeadersEnabled={false}
        />
      ) : (
        <View style={styles.emptyDate}><Text>No plans!</Text></View>
      )}
      </HandlersContext.Provider>
      </EditModeContext.Provider>
      </MetaContext.Provider>

      {/* The Smart Input Area */}
      <View style={[styles.inputPanel, editMode && styles.inputAreaDisabled]}>
        <View style={styles.inputControls}>
          {family ? (
            <ShareToggle
              shared={shareNew}
              onChange={setShareNew}
              disabled={editMode}
              compact
            />
          ) : <View />}
          <InputTips members={members} myId={userId} disabled={editMode} />
        </View>
        <View style={styles.inputArea}>
          <TextInput
            style={[styles.input, editMode && styles.inputDisabled]}
            accessibilityLabel="New event"
            placeholder={placeholderFor(exampleTagOf(members, userId))}
            value={inputText}
            onChangeText={setInputText}
            multiline={false}
            editable={!editMode}
          />
          <TouchableOpacity
            style={[styles.addButton, editMode && styles.addButtonDisabled]}
            onPress={handleAddTask}
            disabled={editMode}
          >
            <Text style={styles.addButtonText}>Add</Text>
          </TouchableOpacity>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f4f4f4' },
  header: { paddingTop: 60, paddingBottom: 12, backgroundColor: '#007BFF', alignItems: 'center' },
  calendarRow: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fff', paddingVertical: 4 },
  arrowBtn: { paddingHorizontal: 12, paddingVertical: 8 },
  arrowText: { fontSize: 20, color: '#007BFF', fontWeight: '600' },
  weekStrip: { flex: 1, flexDirection: 'row', justifyContent: 'space-around' },
  weekDay: { alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderRadius: 8, minWidth: 36 },
  weekDaySelected: { backgroundColor: '#007BFF' },
  weekDayLabel: { fontSize: 11, color: '#999', fontWeight: '600' },
  weekDayNum: { fontSize: 16, color: '#333', fontWeight: '600', marginTop: 2 },
  weekDayTextSelected: { color: '#fff' },
  weekDayDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: '#007BFF', marginTop: 2 },
  weekDayDotSelected: { backgroundColor: '#fff' },
  monthButton: { alignSelf: 'center', paddingVertical: 6 },
  monthButtonText: { fontSize: 14, color: '#007BFF', fontWeight: '600' },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', alignItems: 'center' },
  modalContent: { backgroundColor: '#fff', borderRadius: 12, padding: 8, width: '90%' },
  toolbar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6, backgroundColor: '#fff', borderBottomWidth: 1, borderColor: '#eee' },
  viewModeButtons: { flexDirection: 'row', gap: 4 },
  viewModeBtn: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: 16, borderWidth: 1, borderColor: '#007BFF' },
  viewModeBtnDisabled: { borderColor: '#ccc' },
  viewModeBtnActive: { backgroundColor: '#007BFF' },
  viewModeBtnText: { fontSize: 13, fontWeight: '600', color: '#007BFF' },
  viewModeBtnTextActive: { color: '#fff' },
  disabledText: { color: '#ccc' },
  modifyText: { color: '#007BFF', fontSize: 14, fontWeight: '600' },
  headerTitle: { color: 'white', fontSize: 24, fontWeight: 'bold' },
  settingsButton: { position: 'absolute', right: 16, bottom: 14 },
  settingsText: { color: 'white', fontSize: 14, fontWeight: '600' },
  itemContainer: { backgroundColor: 'white', flex: 1, borderRadius: 5, padding: 15, marginRight: 10, marginTop: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  itemContent: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  itemTime: { fontSize: 14, color: '#666' },
  personIcon: { width: 30, height: 30, borderRadius: 15, marginLeft: 6, resizeMode: 'cover' as const },
  itemText: { flex: 1 },
  itemName: { fontSize: 14, fontWeight: 'bold', color: '#333' },
  legacyTag: { fontSize: 13, color: '#666', fontWeight: '600' },
  sharedLabel: { fontSize: 12, color: '#007BFF', marginTop: 2 },
  itemActions: { flexDirection: 'row', gap: 12, marginLeft: 10 },
  editText: { fontSize: 13, color: '#007BFF', fontWeight: '600' },
  deleteText: { fontSize: 13, color: '#dc3545', fontWeight: '600' },
  itemPast: { opacity: 0.45 },
  textPast: { color: '#aaa' },
  eventList: { flex: 1 },
  sectionHeader: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 4, backgroundColor: '#f4f4f4' },
  sectionHeaderText: { fontSize: 13, fontWeight: '700', color: '#555' },
  emptyDate: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 40 },
  inputPanel: { backgroundColor: 'white', borderTopWidth: 1, borderColor: '#ddd', paddingTop: 10 },
  inputControls: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 15 },
  inputArea: { flexDirection: 'row', paddingHorizontal: 15, paddingTop: 8, paddingBottom: 15 },
  input: { flex: 1, borderWidth: 1, borderColor: '#ccc', borderRadius: 8, padding: 12, fontSize: 16, backgroundColor: '#fff' },
  addButton: { marginLeft: 10, backgroundColor: '#007BFF', paddingHorizontal: 20, justifyContent: 'center', borderRadius: 8 },
  addButtonDisabled: { backgroundColor: '#a0c4e8' },
  inputAreaDisabled: { opacity: 0.5 },
  inputDisabled: { backgroundColor: '#f0f0f0' },
  addButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 }
});
