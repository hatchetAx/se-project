import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import {
	ActivityIndicator,
	Keyboard,
	KeyboardAvoidingView,
	Platform,
	Pressable,
	SafeAreaView,
	ScrollView,
	Text,
	TextInput,
	View,
} from 'react-native';
import { COLORS, styles } from '../styles/splash-page.styles';

type Props = {
	isLoading?: boolean;
	onSearch?: (keywords: string[], filters: SearchFilters) => void;
	onHistory?: () => void;
};

export type SearchFilters = {
	source: 'all' | 'open' | 'closed';
	verifiedOnly: boolean;
};

export default function SplashPage({
	isLoading = false,
	onSearch,
	onHistory,
}: Props) {
	const [keywords, setKeywords] = useState<string[]>([]);
	const [draft, setDraft] = useState('');
	const [sourceFilter, setSourceFilter] =
		useState<SearchFilters['source']>('all');
	const [verifiedOnly, setVerifiedOnly] = useState(false);
	const [filtersOpen, setFiltersOpen] = useState(false);
	const inputRef = useRef<React.ComponentRef<typeof TextInput>>(null);
	const [loadingMessage, setLoadingMessage] = useState('Searching live databases...');

	React.useEffect(() => {
		if (!isLoading) {
			return;
		}

		const messages = [
			'Searching live databases...',
			'Checking sources and open access...',
			'Ranking the best matches...',
		];
		let messageIndex = 0;
		const messageTimer = setInterval(() => {
			messageIndex = (messageIndex + 1) % messages.length;
			setLoadingMessage(messages[messageIndex]);
		}, 2200);
		return () => {
			clearInterval(messageTimer);
		};
	}, [isLoading]);

	// Turns the current draft text into a chip (comma or Enter triggers this).
	const commitDraft = (text: string = draft) => {
		const word = text.trim().toLowerCase();
		if (word && !keywords.includes(word)) {
			setKeywords((prev) => [...prev, word]);
		}
		setDraft('');
	};

	const handleChangeText = (text: string) => {
		if (text.includes(',')) {
			// Supports typing "a, b," or pasting "a, b, c" in one go.
			const parts = text.split(',');
			const last = parts.pop() ?? '';
			parts.forEach((p) => commitDraft(p));
			setDraft(last);
		} else {
			setDraft(text);
		}
	};

	const removeKeyword = (word: string) =>
		setKeywords((prev) => prev.filter((k) => k !== word));

	const handleSearch = () => {
		const finalList = draft.trim()
			? [...keywords, draft.trim().toLowerCase()]
			: keywords;
		const unique = Array.from(new Set(finalList));
		if (unique.length === 0 || isLoading) return;
		setKeywords(unique);
		setDraft('');
		inputRef.current?.blur();
		Keyboard.dismiss();
		onSearch?.(unique, { source: sourceFilter, verifiedOnly });
	};

	return (
		<SafeAreaView style={styles.safe}>
			<KeyboardAvoidingView
				style={styles.flex}
				behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
			>
				<ScrollView
					style={styles.flex}
					contentContainerStyle={styles.container}
					keyboardShouldPersistTaps='handled'
					showsVerticalScrollIndicator={false}
				>
					<Pressable
						style={styles.content}
					onPress={() => {
						inputRef.current?.blur();
						Keyboard.dismiss();
					}}
				>
					{/* Brand */}
					<View style={styles.brand}>
						<Ionicons name='book-outline' size={22} color={COLORS.navy} />
					</View>

					{/* Heading */}
					<View style={styles.hero}>
						<Text style={styles.title}>
							Find the data behind your research.
						</Text>
						<Text style={styles.subtitle}>
							A few keywords. A curated set of web databases.
						</Text>

						{/* Keyword chip input */}
						<View style={styles.keywordArea}>
							<View style={styles.inputRow}>
								<Pressable
									style={styles.inputPill}
									onPress={(event) => {
										event.stopPropagation();
										inputRef.current?.focus();
									}}
									accessibilityRole='none'
								>
									<Pressable
										onPress={(event) => {
											event.stopPropagation();
											commitDraft();
											inputRef.current?.blur();
											Keyboard.dismiss();
										}}
										hitSlop={8}
										accessibilityRole='button'
										accessibilityLabel='Add keyword'
									>
										<Ionicons
											name='add-circle-outline'
											size={17}
											color={COLORS.navy}
										/>
									</Pressable>
									<TextInput
										ref={inputRef}
										style={styles.input}
										value={draft}
										onChangeText={handleChangeText}
										onSubmitEditing={() => {
											commitDraft();
											Keyboard.dismiss();
										}}
										placeholder='Type a keyword'
										placeholderTextColor={COLORS.muted}
										returnKeyType='done'
										blurOnSubmit
										autoCapitalize='none'
										autoCorrect={false}
										editable={!isLoading}
										accessibilityLabel='Type a keyword'
									/>
								</Pressable>
									<Pressable
										style={[
											styles.filterIconButton,
											filtersOpen && styles.filterIconButtonActive,
										]}
										onPress={(event) => {
											event.stopPropagation();
											setFiltersOpen((current) => !current);
										}}
										accessibilityRole='button'
										accessibilityLabel='Search filters'
										accessibilityHint='Open or close search filters'
										accessibilityState={{ expanded: filtersOpen }}
									>
										<Ionicons
											name='options-outline'
											size={18}
											color={COLORS.navy}
										/>
										{(sourceFilter !== 'all' || verifiedOnly) && (
											<View style={styles.filterBadge} />
										)}
									</Pressable>
							</View>
							{keywords.length > 0 && (
								<View style={styles.chipSection}>
									<View style={styles.chips}>
									{keywords.map((word) => (
										<View key={word} style={styles.chip}>
											<Text style={styles.chipText}>{word}</Text>
											<Pressable
												onPress={() => removeKeyword(word)}
												hitSlop={10}
												accessibilityRole='button'
												accessibilityLabel={`Remove ${word}`}
											>
												<Ionicons
													name='close-circle'
													size={16}
													color={COLORS.navy}
												/>
											</Pressable>
										</View>
									))}
									</View>
									<Pressable
										style={styles.clearKeywords}
										onPress={() => setKeywords([])}
										hitSlop={8}
										accessibilityRole='button'
										accessibilityLabel='Clear all keywords'
									>
										<Text style={styles.clearKeywordsText}>Clear all</Text>
									</Pressable>
								</View>
							)}
							{filtersOpen && (
								<View style={styles.filterMenuInside}>
									<Text style={styles.filterMenuTitle}>Search Filters</Text>
									<View style={styles.filterRow}>
										{(
											[
												['all', 'All sources'],
												['open', 'Open source'],
												['closed', 'Closed source'],
											] as const
										).map(([value, label]) => (
											<Pressable
												key={value}
												style={[
													styles.filterChip,
													sourceFilter === value && styles.filterChipActive,
												]}
												onPress={() => setSourceFilter(value)}
												accessibilityRole='button'
												accessibilityState={{
													selected: sourceFilter === value,
												}}
											>
												<Text
													style={[
														styles.filterText,
														sourceFilter === value && styles.filterTextActive,
													]}
												>
													{label}
												</Text>
											</Pressable>
										))}
									</View>
									<Pressable
										style={[
											styles.filterChip,
											verifiedOnly && styles.filterChipActive,
										]}
										onPress={() => setVerifiedOnly((current) => !current)}
										accessibilityRole='button'
										accessibilityState={{ selected: verifiedOnly }}
									>
										<Ionicons
											name='checkmark-circle-outline'
											size={14}
											color={verifiedOnly ? COLORS.white : COLORS.navy}
										/>
										<Text
											style={[
												styles.filterText,
												verifiedOnly && styles.filterTextActive,
											]}
										>
											Verified Only
										</Text>
									</Pressable>
								</View>
							)}
						</View>
						<Text style={styles.note}>
							Order doesn&apos;t matter. Repeat searches load instantly from your
							device.
						</Text>

						{/* Actions, Search Button*/}
						<View style={styles.actions}>
							<Pressable
								style={[
									styles.primaryBtn,
									(isLoading || (keywords.length === 0 && !draft.trim())) &&
										styles.btnDisabled,
								]}
								onPress={handleSearch}
								disabled={isLoading}
								accessibilityRole='button'
								accessibilityLabel='Search'
							>
								{isLoading ? (
									<ActivityIndicator color={COLORS.white} />
								) : (
									<>
										<Ionicons name='search' size={18} color={COLORS.white} />
										<Text style={styles.primaryText}>Search</Text>
									</>
								)}
							</Pressable>

							{/* 
              onSearch={(keywords) =>
        router.push({
          pathname: "/results",
          params: { keywords: keywords.join(",") },
        })
      } */}

							{/* History Button */}
							<Pressable
								style={styles.secondaryBtn}
								onPress={onHistory}
								accessibilityRole='button'
								accessibilityLabel='History'
							>
								<Ionicons name='time-outline' size={18} color={COLORS.navy} />
								<Text style={styles.secondaryText}>History</Text>
							</Pressable>
						</View>

						{isLoading ? (
							<View style={styles.loadingHint}>
								<ActivityIndicator size='small' color={COLORS.navy} />
								<Text style={styles.loadingHintText}>{loadingMessage}</Text>
							</View>
						) : (
							<Text style={styles.hint}>
								Type a keyword, then type a comma or Enter.
							</Text>
						)}
					</View>

					{/* Footer */}
						<View style={styles.footer}>
							<Text style={styles.footerLabel}>
								YOUR DATABASE DISCOVERY TOOL
							</Text>
							<Text style={styles.footerText}>
								Search web databases. Save sets. Ask AI questions.
							</Text>
						</View>
					</Pressable>
				</ScrollView>
			</KeyboardAvoidingView>
		</SafeAreaView>
	);
}
