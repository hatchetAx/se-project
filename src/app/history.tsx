import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, SafeAreaView, Text, View } from 'react-native';
import { useResultsDatabase } from '../components/resultsDatabase';
import {
	clearHistory,
	deleteHistory,
	getHistory,
	type HistoryEntry,
} from '../components/historyStore';
import { COLORS, styles } from './styles/history-page.styles';

export default function History() {
	const db = useResultsDatabase();
	const [entries, setEntries] = useState<HistoryEntry[]>([]);
	const [editing, setEditing] = useState(false);

	const loadHistory = useCallback(async () => {
		setEntries(await getHistory(db));
	}, [db]);

	useEffect(() => {
		// eslint-disable-next-line react-hooks/set-state-in-effect
		void loadHistory();
	}, [loadHistory]);

	const removeEntry = async (id: number) => {
		await deleteHistory(db, id);
		setEntries((current) => current.filter((entry) => entry.id !== id));
	};

	const clearAllHistory = async () => {
		await clearHistory(db);
		setEntries([]);
	};

	return (
		<SafeAreaView style={styles.safe}>
			<View style={styles.container}>
				<View style={styles.header}>
					<Pressable
						onPress={() => router.back()}
						accessibilityRole='button'
						accessibilityLabel='Back'
					>
						<Ionicons name='arrow-back' size={22} color={COLORS.navy} />
					</Pressable>
					<Text style={styles.title}>Search history</Text>
					<Pressable
						onPress={() => setEditing((current) => !current)}
						accessibilityRole='button'
						accessibilityLabel={
							editing ? 'Done editing history' : 'Edit history'
						}
					>
						<Text style={styles.editText}>{editing ? 'Done' : 'Edit'}</Text>
					</Pressable>
				</View>

				{editing && entries.length > 0 && (
					<Pressable
						style={styles.clearHistoryButton}
						onPress={() => void clearAllHistory()}
						accessibilityRole='button'
						accessibilityLabel='Clear search history and cached searches'
					>
						<Ionicons name='trash-outline' size={16} color={COLORS.navy} />
						<Text style={styles.clearHistoryText}>Clear History</Text>
					</Pressable>
				)}

				{entries.length === 0 ? (
					<View style={styles.empty}>
						<Ionicons name='time-outline' size={32} color={COLORS.muted} />
						<Text style={styles.emptyTitle}>No Results</Text>
						<Text style={styles.emptyBody}>
							Searches you make will appear here.
						</Text>
					</View>
				) : (
					<View style={styles.list}>
						{entries.map((entry) => (
							<View key={entry.id} style={styles.row}>
								<Pressable
									style={styles.entry}
									onPress={
										editing
											? undefined
											: () =>
													router.push({
														pathname: '/results',
														params: { keywords: entry.keywords.join(',') },
													})
									}
									accessibilityRole={editing ? undefined : 'button'}
									accessibilityLabel={
										editing
											? `Selected search ${entry.keywords.join(', ')}`
											: `Search ${entry.keywords.join(', ')}`
									}
								>
									<View style={styles.entryText}>
										<Text style={styles.keywords} numberOfLines={1}>
											{entry.keywords.join(', ')}
										</Text>
										{!entry.hasResults && (
											<Text style={styles.noResults}>No Results</Text>
										)}
									</View>
								</Pressable>
								{editing ? (
									<Pressable
										onPress={() => void removeEntry(entry.id)}
										hitSlop={10}
										accessibilityRole='button'
										accessibilityLabel={`Remove ${entry.keywords.join(', ')}`}
									>
										<Ionicons
											name='trash-outline'
											size={19}
											color={COLORS.muted}
										/>
									</Pressable>
								) : (
									<Pressable
										style={styles.againButton}
										onPress={() =>
											router.push({
												pathname: '/results',
												params: { keywords: entry.keywords.join(',') },
											})
										}
										accessibilityRole='button'
										accessibilityLabel={`Search again for ${entry.keywords.join(', ')}`}
									>
										<Text style={styles.againText}>Search Again</Text>
									</Pressable>
								)}
							</View>
						))}
					</View>
				)}
			</View>
		</SafeAreaView>
	);
}
