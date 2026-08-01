use std::collections::HashSet;

use crate::domain::AnswerIssue;

const MIN_CHARS: usize = 90;
const MIN_WORDS: usize = 14;
const MIN_HANGUL_CHARS: usize = 60;
const MIN_HANGUL_WORDS: usize = 10;
const ECHO_MAX: f32 = 0.55;

pub fn assess(question: &str, answer: &str) -> Vec<AnswerIssue> {
    let text = answer.trim();
    if text.is_empty() {
        return vec![AnswerIssue {
            rule: "Low-effort answers".to_owned(),
            detail: "The answer is empty.".to_owned(),
        }];
    }

    let words = content_words(text);
    let unique = words.iter().collect::<HashSet<_>>();
    let mut issues = Vec::new();

    let contains_hangul = text.chars().any(is_hangul);
    let min_chars = if contains_hangul {
        MIN_HANGUL_CHARS
    } else {
        MIN_CHARS
    };
    let min_words = if contains_hangul {
        MIN_HANGUL_WORDS
    } else {
        MIN_WORDS
    };

    if text.chars().count() < min_chars || unique.len() < min_words {
        issues.push(AnswerIssue {
            rule: "Low-effort answers".to_owned(),
            detail: "Too short to be a document. Nobody buys one line, and the buyer is charged for every opened answer.".to_owned(),
        });
    }

    if !has_specifics(text) {
        issues.push(AnswerIssue {
            rule: "Low-effort answers".to_owned(),
            detail: "No place, time, price, or number appears in the answer. Those lived details are the part worth paying for.".to_owned(),
        });
    }

    let asked = content_words(question).into_iter().collect::<HashSet<_>>();
    if !asked.is_empty() && !unique.is_empty() {
        let echoed = unique.iter().filter(|word| asked.contains(**word)).count();
        if echoed as f32 / unique.len() as f32 > ECHO_MAX {
            issues.push(AnswerIssue {
                rule: "Low-effort answers".to_owned(),
                detail: "Mostly repeats the question instead of describing what actually happened."
                    .to_owned(),
            });
        }
    }

    issues
}

fn content_words(text: &str) -> Vec<String> {
    text.to_lowercase()
        .split(|character: char| !character.is_alphanumeric())
        .filter(|word| {
            let length = word.chars().count();
            if word.chars().any(is_hangul) {
                length >= 2
            } else {
                length >= 4
            }
        })
        .filter(|word| !is_stopword(word))
        .map(ToOwned::to_owned)
        .collect()
}

fn has_specifics(text: &str) -> bool {
    if text.chars().any(|character| character.is_ascii_digit()) {
        return true;
    }
    if text
        .split_whitespace()
        .skip(1)
        .any(|word| word.chars().next().is_some_and(char::is_uppercase))
    {
        return true;
    }

    text.split_whitespace().any(|raw| {
        let word = raw.trim_matches(|character: char| !character.is_alphanumeric());
        if word.chars().count() < 3 || !word.chars().any(is_hangul) {
            return false;
        }
        let stem = ["에서는", "에서", "에는", "으로", "까지", "부터"]
            .into_iter()
            .find_map(|ending| word.strip_suffix(ending))
            .unwrap_or(word);
        [
            "동", "구", "시", "역", "로", "길", "시장", "학교", "병원", "공원",
        ]
        .into_iter()
        .any(|ending| stem.ends_with(ending))
    })
}

fn is_hangul(character: char) -> bool {
    ('가'..='힣').contains(&character)
}

fn is_stopword(word: &str) -> bool {
    matches!(
        word,
        "about"
            | "after"
            | "again"
            | "also"
            | "because"
            | "been"
            | "before"
            | "being"
            | "between"
            | "both"
            | "could"
            | "does"
            | "doing"
            | "during"
            | "each"
            | "from"
            | "have"
            | "having"
            | "here"
            | "into"
            | "just"
            | "like"
            | "more"
            | "most"
            | "much"
            | "only"
            | "other"
            | "over"
            | "same"
            | "some"
            | "such"
            | "than"
            | "that"
            | "their"
            | "them"
            | "then"
            | "there"
            | "these"
            | "they"
            | "this"
            | "those"
            | "through"
            | "very"
            | "were"
            | "what"
            | "when"
            | "where"
            | "which"
            | "while"
            | "with"
            | "would"
            | "your"
            | "actually"
            | "really"
            | "thing"
            | "things"
            | "something"
    )
}

#[cfg(test)]
mod tests {
    use super::assess;

    #[test]
    fn accepts_a_specific_lived_answer() {
        let issues = assess(
            "Where do you eat lunch in Seongsu?",
            "I leave the office at 11:40 and walk seven minutes toward Seoul Forest. The noodle shop beside Exit 3 charges 9,000 won, and I am usually back at my desk within 25 minutes even on Tuesday.",
        );
        assert!(issues.is_empty());
    }

    #[test]
    fn rejects_a_short_generic_answer() {
        let issues = assess(
            "Where do you eat lunch in Seongsu?",
            "There are many good restaurants and I usually choose whatever looks nice.",
        );
        assert!(!issues.is_empty());
    }

    #[test]
    fn accepts_a_specific_korean_lived_answer() {
        let issues = assess(
            "성수동에서 점심 줄을 피하려면 실제로 어디에 가나요?",
            "저는 2025년 봄부터 성수동 사무실에서 일했습니다. 화요일에는 오전 11시 40분에 나와 서울숲역 쪽으로 7분 정도 걷습니다. 골목 안 국수집은 한 그릇에 9,000원이고 주문 뒤 10분 안에 나와서 보통 12시 25분 전에 자리로 돌아옵니다.",
        );
        assert!(issues.is_empty(), "{issues:?}");
    }

    #[test]
    fn rejects_a_generic_korean_answer() {
        let issues = assess(
            "성수동에서 점심 줄을 피하려면 실제로 어디에 가나요?",
            "성수동에는 맛있는 곳이 많아서 상황에 따라 좋은 식당을 찾아가면 됩니다.",
        );
        assert!(!issues.is_empty());
    }
}
