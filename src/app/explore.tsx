import { useState, useEffect } from "react";
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { API_BASE_URL } from "@/constants/api";

interface Session {
  session_id: string;
  timestamp: string;
  question: string;
  answer: string;
  images_urls: string[];
}

export default function HistoryScreen() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = async () => {
    try {
      setError(null);
      const response = await fetch(`${API_BASE_URL}/history`);
      if (!response.ok) {
        throw new Error("Failed to load history from backend");
      }
      const data = await response.json();
      setSessions(data.sessions || []);
    } catch (err: any) {
      setError(err.message || "Could not connect to backend");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    setLoading(true);
    fetchHistory();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchHistory();
  };

  const formatDate = (isoStr: string) => {
    try {
      const d = new Date(isoStr);
      return d.toLocaleString();
    } catch {
      return isoStr;
    }
  };

  const renderItem = ({ item }: { item: Session }) => (
    <View style={styles.card}>
      <Text style={styles.timestamp}>{formatDate(item.timestamp)}</Text>
      <Text style={styles.questionLabel}>Question:</Text>
      <Text style={styles.questionText}>"{item.question}"</Text>

      <Text style={styles.answerLabel}>Gemini Answer:</Text>
      <Text style={styles.answerText}>{item.answer}</Text>

      {item.images_urls && item.images_urls.length > 0 && (
        <View style={styles.imagesContainer}>
          <Text style={styles.imagesLabel}>Analyzed Frames ({item.images_urls.length}):</Text>
          <FlatList
            horizontal
            data={item.images_urls}
            keyExtractor={(imgUrl, index) => `${item.session_id}_img_${index}`}
            renderItem={({ item: imgPath }) => (
              <Image
                source={{ uri: `${API_BASE_URL}${imgPath}` }}
                style={styles.historyImage}
                resizeMode="cover"
              />
            )}
            showsHorizontalScrollIndicator={false}
          />
        </View>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Visual History</Text>
      <Text style={styles.subtitle}>Past questions, answers, and frame memories</Text>

      {loading ? (
        <ActivityIndicator size="large" color="#1a73e8" style={styles.loader} />
      ) : error ? (
        <View style={styles.errorBox}>
          <Text style={styles.errorText}>{error}</Text>
          <Pressable style={styles.retryButton} onPress={fetchHistory}>
            <Text style={styles.retryText}>Retry</Text>
          </Pressable>
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.emptyBox}>
          <Text style={styles.emptyText}>No history sessions saved yet.</Text>
          <Text style={styles.emptySubtext}>Ask VisionAI a question from the Home screen to record sessions.</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(item) => item.session_id}
          renderItem={renderItem}
          contentContainerStyle={styles.listContainer}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#f5f5f5",
    paddingTop: 50,
    paddingHorizontal: 16,
  },
  title: {
    fontSize: 30,
    fontWeight: "bold",
    textAlign: "center",
  },
  subtitle: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
    marginBottom: 20,
  },
  loader: {
    marginTop: 40,
  },
  listContainer: {
    paddingBottom: 40,
  },
  card: {
    backgroundColor: "white",
    borderRadius: 16,
    padding: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: "#e0e0e0",
  },
  timestamp: {
    fontSize: 12,
    color: "#888",
    marginBottom: 8,
  },
  questionLabel: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#555",
  },
  questionText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a73e8",
    marginBottom: 10,
  },
  answerLabel: {
    fontSize: 13,
    fontWeight: "bold",
    color: "#555",
  },
  answerText: {
    fontSize: 14,
    color: "#333",
    lineHeight: 20,
    marginBottom: 12,
  },
  imagesContainer: {
    marginTop: 8,
  },
  imagesLabel: {
    fontSize: 12,
    fontWeight: "bold",
    color: "#777",
    marginBottom: 6,
  },
  historyImage: {
    width: 120,
    height: 90,
    borderRadius: 8,
    marginRight: 8,
    backgroundColor: "#eee",
  },
  errorBox: {
    alignItems: "center",
    marginTop: 40,
  },
  errorText: {
    fontSize: 15,
    color: "#d93025",
    textAlign: "center",
    marginBottom: 12,
  },
  retryButton: {
    backgroundColor: "#222",
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  retryText: {
    color: "white",
    fontWeight: "600",
  },
  emptyBox: {
    alignItems: "center",
    marginTop: 40,
  },
  emptyText: {
    fontSize: 16,
    fontWeight: "600",
    color: "#444",
  },
  emptySubtext: {
    fontSize: 13,
    color: "#888",
    textAlign: "center",
    marginTop: 6,
  },
});
