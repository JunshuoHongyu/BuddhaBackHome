declare namespace APJS {
  class SocialFeatures {
  }
  
  /**
   * 业务门面只暴露两个能力：
   * - sendRequest: 通过 Game2D.onEvent 桥接统一收发
   * - saveMessageForPublish: 走 publish 写回
   */
  class SocialService {
    constructor(scene: IRequestScene);
  }
  
  class POI {
  }
  
  /**
   * @namespace Checkin
   * @description Reads check-in statistics and explicitly prepares check-in submission data.
   */
  namespace Checkin {
    /**
     * @description Retrieves the current effect's check-in statistics. The runtime first resolves
     * the effect id, then requests the check-in payload. Reading never saves submission data.
     * Ordinary check-in scripts must call saveSubmission after the data callback; challenge-based
     * scripts must call it only after the current recording's complete daily challenge succeeds.
     * Returned statistics include the display increment; do not increment them again.
     * @param scene - The current engine scene used for social requests and submission publishing.
     * @param options - Optional subType (defaults to 1) and fallback values (each defaults to 1).
     * @param callbacks - onSuccess receives normalized statistics or fallback values when the request
     * is unavailable. It does not confirm a successful fetch or a completed submission.
     */
    function getCheckinData(scene: unknown, options?: {
        subType?: number;
        fallback?: {
          effectSubmissionUsers?: number;
          effectSubmissionTimes?: number;
          userSubmissionTimes?: number;
          userSubmissionDays?: number;
          userConsecutiveSubmissionDays?: number;
        };
      }, callbacks?: {
        onSuccess?: (value: {
          /** Number of users who have submitted with this effect. */
          effectSubmissionUsers: number;
          /** Number of submissions using this effect. */
          effectSubmissionTimes: number;
          /** Current user's submission count. */
          userSubmissionTimes: number;
          /** Current user's cumulative check-in days; use for "打卡第 X 天". */
          userSubmissionDays: number;
          /** Current user's consecutive check-in days. */
          userConsecutiveSubmissionDays: number;
        }) => void;
        onError?: (error: Error) => void;
      }): void;
  
    /**
     * @description Explicitly prepares check-in data to accompany a later user submission.
     * Normally call this after getCheckinData completes. For check-in challenges, call it only
     * after the current recording's full daily challenge succeeds, never during a trial, on
     * failure, or just because data arrived or recording began. The caller controls deduplication.
     * @param scene - The current engine scene; the effect id is resolved internally.
     * @param callbacks - onSuccess means the publish message was dispatched, not that the host
     * accepted it or the user published successfully. DYEH only simulates this call without
     * modifying check-in statistics. onError reports effect-id lookup or dispatch failures.
     */
    function saveSubmission(scene: unknown, callbacks?: {
        onSuccess?: () => void;
        onError?: (error: Error) => void;
      }): void;
  }
  
  /**
   * @namespace Vote
   * @description Reads effect vote results and stores vote data for the final publish action.
   */
  namespace Vote {
    function getLocalResults(items: Array<{index: number; name: string; score: number}>): Array<{rank: number; index: number; name: string; score: number}>;
  
    function getResults(scene: unknown, options?: {pendingVotes?: Array<{index: number; name: string; score: number}>}, callbacks?: {
        onSuccess?: (value: Array<{
          rank: number;
          index: number;
          name: string;
          score: number;
        }>) => void;
        onError?: (error: Error) => void;
      }): void;
  
    function setVotesForPublish(scene: unknown, items: Array<{index: number; name: string; score: number}>, callbacks?: {
        onSuccess?: (value: {
          success: boolean;
          status: 'enqueued' | 'validation_failed' | 'effect_info_failed' | 'timeout';
          message?: string;
        }) => void;
        onError?: (error: Error) => void;
      }): void;
  }
  
  /**
   * @namespace SocialInheritance
   * @description Reads the previous recording's memory and saves current inputs on RecordEnd.
   */
  namespace SocialInheritance {
    function beginRecording(scene: Scene): void;
  
    function clearInputs(scene: Scene): void;
  
    function dispose(scene: Scene): void;
  
    function endRecording(scene: Scene): void;
  
    function getLastWriteResult(scene: Scene): {
      success: boolean;
      status: 'committed' | 'no_input' | 'not_ready' | 'invalid_input' | 'path_unavailable'
        | 'texture_not_ready' | 'write_failed' | 'unsupported' | 'disposed';
    } | null;
  
    function loadPrevious(scene: Scene, callback: (result: {
      success: boolean;
      status: 'loaded' | 'empty' | 'timeout' | 'error' | 'unsupported' | 'disposed';
      data: {
        numberValue?: number | null; numberArray?: number[] | null;
        stringValue?: string | null; stringArray?: string[] | null;
        booleanValue?: boolean | null; booleanArray?: boolean[] | null;
        texture?: Texture | null;
      };
    }) => void): void;
  
    function prepare(scene: Scene): void;
  
    function setInputs(scene: Scene, readInputs: () => {
      numberValue?: number | null; numberArray?: number[] | null;
      stringValue?: string | null; stringArray?: string[] | null;
      booleanValue?: boolean | null; booleanArray?: boolean[] | null;
      texture?: Texture | null;
    }): void;
  
    function update(scene: Scene, deltaTime: number): void;
  }
  
  /**
   * @namespace PersonalInfo
   * @description Retrieves profile data and avatar textures for custom personal card layouts.
   */
  namespace PersonalInfo {
    /**
     * @description Retrieves the requested profile fields and prepares a ready-to-use avatar texture
     * inside the returned payload, so gameplay scripts can render the avatar without separate
     * download or texture-loading steps.
     * @param scene - The current engine scene used for social messaging and texture loading.
     * @param options - Optional target type, intimacy, and appId settings for the profile request.
     * @param callbacks - Called with the normalized profile data on success, or an Error on failure.
     */
    function getPersonalInfo(scene: unknown, options?: {targetType?: 0 | 1 | 2 | 3; intimacy?: number; appId?: number}, callbacks?: {
        onSuccess?: (value: {
          nickname: string;
          gender: string;
          age: string;
          zodiac: string;
          birthday: string;
          constellation: string;
          profile: string;
          city: string;
          school: string;
          avatarUrl: string;
          avatarTexture: Texture | null;
          uid: string;
          obfuscatedUid: string;
          raw: {
            avatar?: string | null;
            user_name?: string | null;
            gender?: string | number | null;
            age?: string | number | null;
            cn_zodiac?: string | null;
            birthday?: string | null;
            zodiac?: string | null;
            desc?: string | null;
            city?: string | null;
            school_name?: string | null;
            uid?: string | number | null;
            [key: string]: unknown;
          };
        }) => void;
        onError?: (error: Error) => void;
      }): void;
  }
  
  class FriendAvatars {
  }
  
  /**
   * @namespace FriendSelection
   * @description Creates independent friend selectors for custom UI and per-instance publish notices.
   */
  namespace FriendSelection {
    /**
     * @description Creates a selector with independent state. Bind select to a UI button and call
     * dispose when the owning script is destroyed. Each instance prepares its own notice on RecordEnd.
     * @param scene - The engine scene or a wrapper containing sys.engineScene.
     * @param options - Relationship (0 friends, 2 following, 3 fans), default loading and picker timeout.
     * @param callbacks - Selected display nickname with @ prefix, texture updates and errors.
     */
    function create(scene: unknown, options?: {relationTag?: 0 | 2 | 3; loadDefault?: boolean; selectionTimeoutMs?: number}, callbacks?: {
        onChange?: (friend: {uid: string; nickname: string; texture: Texture | null}) => void;
        onError?: (error: Error) => void;
      }): {
      select(): void;
      cancelSelect(): void;
      getSelected(): {uid: string; nickname: string; texture: Texture | null} | null;
      dispose(): void;
    };
  }
  
  class AIConversation {
  }
  
  class ImageCaption {
  }
  
  /**
   * @namespace SpeechText
   * @description Reports text processed by online speech abilities to the host.
   */
  namespace SpeechText {
    /**
     * @description Reports recognized or synthesized text to the host.
     * @param scene An APJS Scene, or a scene container whose sys.engineScene is an APJS Scene.
     * @param text The recognized or synthesized text.
     * @returns Whether the message was sent.
     */
    function report(scene: unknown, text: string): boolean;
  }
  
  /**
   * @namespace Mosaic
   * @description Controls the built-in mosaic at runtime without changing saved initial values.
   */
  namespace Mosaic {
    function getVisible(object: SceneObject): boolean | null;
  
    function setVisible(object: SceneObject, visible: boolean): {
      success: boolean;
      status: 'updated' | 'missing_component' | 'ambiguous_component' | 'not_ready'
        | 'invalid_input' | 'error';
    };
  }
  
  /**
   * @namespace SpeechRecognition
   * @description Speech recognition entry. Call during onInit.
   */
  namespace SpeechRecognition {
    function getOrCreateBuilder(): SpeechRecognizerBuilder;
  }
  
  /**
   * @enum SpeechRecognitionEventType
   * @description Speech recognition event type.
   */
  enum SpeechRecognitionEventType {
    RecognizedSuccess,
    RecognizedFailed,
  }
  
  /**
   * @class SpeechRecognizer
   * @description Speech recognizer.
   * @example
   * OnInit() {
   *     const builder = SpeechRecognition.getOrCreateBuilder();
   *     builder.setDetectorSource(AudioSourceType.Microphone, null);
   *     this.recognizer = builder.build() as SpeechRecognizer;
   *     if (this.recognizer) {
   *         this.recognizer.eventEmitter.on(SpeechRecognitionEventType.RecognizedSuccess, (event) => {
   *             const words = event.args[0];
   *             console.log('Recognized:', words);
   *         });
   *         this.recognizer.start();
   *     }
   * }
   */
  class SpeechRecognizer implements IAudioDetector {
    protected constructor();
  
    /**
     * @description Whether the detector is enabled.
     */
    enabled: boolean;
  
    /**
     * @description The event emitter.
     */
    get eventEmitter(): IEventEmitter;
  
    /**
     * @description Start speech recognition.
     */
    start(): void;
  
    /**
     * @description Stop speech recognition.
     */
    stop(): void;
  }
  
  /**
   * @class SpeechRecognizerBuilder
   * @description Speech recognizer builder.
   */
  class SpeechRecognizerBuilder extends AudioDetectorBuilder<SpeechRecognizer> {
    protected constructor();
  
    /**
     * @description Build the SpeechRecognizer during OnInit, otherwise it will return null.
     */
    build(): SpeechRecognizer | null;
  }
  
  /**
   * @enum TextToSpeechEventType
   * @description Text to speech lifecycle event type.
   */
  enum TextToSpeechEventType {
    SynthesisSucceeded,
    PlaybackStarted,
    PlaybackEnded,
  }
  
  /**
   * @enum VoiceType
   * @description Voice type for TTS.
   */
  enum VoiceType {
    Rapper,
    WarmheartedBrother,
    RefreshingMaleAdult,
    RoaringBrother,
    ArtisticMale,
    ConcubineHua,
    ArtisticFemale,
    MonkeyBrotherRap,
    LazyLittleSheep,
    NaYing,
    YangMi,
    NasalVoice,
    MonkeyBrother,
    Child,
    FreshFemaleVoice,
    ShyMonkeyBrother,
    SisterSpring,
    Emperor,
    HongKongDramaFemale,
    BearTwo,
  }
  
  /**
   * @class TextToSpeechSynthesizer
   * @description Text to speech synthesizer.
   * @example
   * OnInit() {
   *     const builder = TextToSpeech.createBuilder();
   *     this.synthesizer = builder.build() as TextToSpeechSynthesizer;
   *     if (this.synthesizer) {
   *         this.synthesizer.synthesize('Hello world', VoiceType.FreshFemaleVoice, () => {
   *             console.log('Synthesize Success');
   *             this.synthesizer.play();
   *         }, (errorMsg) => {
   *             console.log('Synthesize Failed:', errorMsg);
   *         });
   *     }
   * }
   */
  class TextToSpeechSynthesizer implements IAudioDetector {
    protected constructor();
  
    enabled: boolean;
  
    /**
     * @description The event emitter for synthesis and playback lifecycle events.
     */
    get eventEmitter(): IEventEmitter;
  
    /**
     * @description The speech speed (0.5-2.0).
     */
    get speed(): number;
  
    set speed(value: number);
  
    /**
     * @description The volume of the synthesizer (0-100).
     */
    get volume(): number;
  
    set volume(value: number);
  
    /**
     * @description Pause playing current audio.
     */
    pause(): void;
  
    /**
     * @description Play the synthesized audio.
     */
    play(): void;
  
    /**
     * @description Resume playing current audio.
     */
    resume(): void;
  
    /**
     * @description Stop playing current audio.
     */
    stop(): void;
  
    /**
     * @description Start text to speech synthesis. Call play after synthesis succeeds.
     * @param text The text to synthesize.
     * @param voice The voice type.
     * @param onSuccess Callback when synthesis succeeds.
     * @param onFail Callback when synthesis fails.
     * @returns Whether the task was started successfully.
     */
    synthesize(text: string, voice: VoiceType, onSuccess: () => void, onFail: (errorMessage: string) => void): boolean;
  }
  
  /**
   * @class TextToSpeechSynthesizerBuilder
   * @description Text to speech synthesizer builder.
   */
  class TextToSpeechSynthesizerBuilder extends AudioDetectorBuilder<TextToSpeechSynthesizer> {
    protected constructor();
  
    /**
     * @description Build the TextToSpeechSynthesizer during OnInit, otherwise it will return null.
     */
    build(): TextToSpeechSynthesizer | null;
  }
  
  /**
   * @namespace TextToSpeech
   * @description Text-to-speech entry. Call during onInit.
   */
  namespace TextToSpeech {
    function createBuilder(): TextToSpeechSynthesizerBuilder;
  }
}