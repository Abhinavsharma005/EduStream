
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plus, CheckCircle2, HelpCircle } from "lucide-react";

interface Quiz {
    id: string;
    question: string;
    options: string[];
    correctOptionIndex: number;
    answers: Record<string, number>; // idx -> count
}

interface QuizViewProps {
    quizzes: Quiz[];
    isTeacher: boolean;
    onCreateQuiz: (question: string, options: string[], correctIndex: number) => void;
    onAnswer: (quizId: string, optionIndex: number) => void;
}

export function QuizView({ quizzes, isTeacher, onCreateQuiz, onAnswer }: QuizViewProps) {
    const [isCreating, setIsCreating] = useState(false);
    const [question, setQuestion] = useState("");
    const [options, setOptions] = useState(["", "", "", ""]); // 4 options default
    const [correctIndex, setCorrectIndex] = useState(0);
    const [answeredQuizzes, setAnsweredQuizzes] = useState<Set<string>>(new Set());

    const updateOption = (idx: number, txt: string) => {
        const newOpts = [...options];
        newOpts[idx] = txt;
        setOptions(newOpts);
    };

    const handleCreate = () => {
        const validOptions = options.filter(o => o.trim());
        if (question.trim() && validOptions.length >= 2) {
            onCreateQuiz(question, validOptions, correctIndex);
            setIsCreating(false);
            setQuestion("");
            setOptions(["", "", "", ""]);
            setCorrectIndex(0);
        }
    };

    const handleAnswer = (quizId: string, idx: number) => {
        if (answeredQuizzes.has(quizId)) return;
        onAnswer(quizId, idx);
        setAnsweredQuizzes(prev => new Set(prev).add(quizId));
    };

    return (
        <div className="h-full flex flex-col p-4 space-y-4 overflow-y-auto">
            {isTeacher && !isCreating && (
                <Button onClick={() => setIsCreating(true)} className="w-full bg-purple-600 hover:bg-purple-500">
                    <Plus className="mr-2 h-4 w-4" /> Create New Quiz
                </Button>
            )}

            {isCreating && (
                <Card className="bg-gray-800 border-gray-700 text-white">
                    <CardHeader className="pb-2">
                        <CardTitle className="text-sm">New Quiz</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <Input
                            placeholder="Quiz Question"
                            className="bg-gray-900 border-gray-600"
                            value={question}
                            onChange={(e) => setQuestion(e.target.value)}
                        />
                        <div className="space-y-2">
                            <p className="text-xs text-gray-400">Options (Select correct answer)</p>
                            {options.map((opt, idx) => (
                                <div key={idx} className="flex gap-2 items-center">
                                    <input
                                        type="radio"
                                        name="correct"
                                        checked={correctIndex === idx}
                                        onChange={() => setCorrectIndex(idx)}
                                        className="h-4 w-4 bg-gray-900"
                                    />
                                    <Input
                                        placeholder={`Option ${idx + 1}`}
                                        className="bg-gray-900 border-gray-600 h-8 text-sm flex-1"
                                        value={opt}
                                        onChange={(e) => updateOption(idx, e.target.value)}
                                    />
                                </div>
                            ))}
                        </div>
                        <div className="flex gap-2 pt-2">
                            <Button size="sm" variant="ghost" className="flex-1" onClick={() => setIsCreating(false)}>Cancel</Button>
                            <Button size="sm" className="flex-1 bg-purple-600 hover:bg-purple-500" onClick={handleCreate}>Launch</Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            <div className="space-y-4">
                {quizzes.slice().reverse().map((quiz) => {
                    const totalAnswers = Object.values(quiz.answers || {}).reduce((a, b) => a + b, 0);
                    const hasAnswered = answeredQuizzes.has(quiz.id);

                    return (
                        <Card key={quiz.id} className="bg-gray-800 border-gray-700 text-white">
                            <CardHeader className="pb-2 pt-4">
                                <CardTitle className="text-base leading-tight flex items-start gap-2">
                                    <HelpCircle className="h-5 w-5 text-purple-400 shrink-0 mt-0.5" />
                                    {quiz.question}
                                </CardTitle>
                                {isTeacher && (
                                    <div className="text-xs text-gray-400 pl-7">{totalAnswers} answers</div>
                                )}
                            </CardHeader>
                            <CardContent className="space-y-2 pl-7.container">
                                {quiz.options.map((opt, idx) => {
                                    // Stats calculation
                                    const count = quiz.answers && quiz.answers[idx] ? quiz.answers[idx] : 0;
                                    const percent = totalAnswers > 0 ? Math.round((count / totalAnswers) * 100) : 0;

                                    const isCorrect = idx === quiz.correctOptionIndex;

                                    return (
                                        <div
                                            key={idx}
                                            className={`relative rounded-md border p-2 text-sm transition-all
                                                ${!hasAnswered && !isTeacher ? 'cursor-pointer hover:bg-gray-700 border-gray-600' : ''}
                                                ${hasAnswered || isTeacher ? 'cursor-default' : ''}
                                                ${isTeacher && isCorrect ? 'border-green-500/50 bg-green-900/10' : 'border-gray-600'}
                                            `}
                                            onClick={() => !isTeacher && !hasAnswered && handleAnswer(quiz.id, idx)}
                                        >
                                            <div className="flex justify-between items-center relative z-10">
                                                <span>{opt}</span>
                                                {(isTeacher || hasAnswered) && (
                                                    <span className="text-xs font-bold opacity-70">{percent}%</span>
                                                )}
                                            </div>

                                            {/* Bar */}
                                            {(isTeacher || hasAnswered) && (
                                                <div className={`absolute left-0 bottom-0 top-0 opacity-20 transition-all duration-500
                                                    ${isCorrect ? 'bg-green-500' : 'bg-gray-500'}
                                                 `} style={{ width: `${percent}%` }} />
                                            )}
                                        </div>
                                    );
                                })}
                                {hasAnswered && <p className="text-xs text-purple-300 mt-2">Answer Submitted!</p>}
                            </CardContent>
                        </Card>
                    );
                })}
                {quizzes.length === 0 && !isCreating && (
                    <div className="text-center text-gray-500 py-8 text-sm">No active quizes</div>
                )}
            </div>
        </div>
    );
}
