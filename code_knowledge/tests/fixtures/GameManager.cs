using UnityEngine;
using System;
using System.Collections.Generic;

namespace Game.Core
{
    public enum GameState
    {
        MainMenu,
        Playing,
        Paused,
        GameOver
    }

    public interface IGameService
    {
        void Initialize();
        void Shutdown();
    }

    [Serializable]
    public struct GameSettings
    {
        public float difficulty;
        public int maxPlayers;
        public bool enableTutorial;
    }

    public class GameManager : MonoBehaviour
    {
        public static GameManager Instance { get; private set; }

        [SerializeField] private GameSettings defaultSettings;

        public GameState CurrentState { get; private set; } = GameState.MainMenu;
        public event Action<GameState> OnStateChanged;

        private readonly List<IGameService> _services = new();

        private void Awake()
        {
            if (Instance != null && Instance != this)
            {
                Destroy(gameObject);
                return;
            }

            Instance = this;
            DontDestroyOnLoad(gameObject);
        }

        private void Start()
        {
            InitializeServices();
        }

        private void OnDestroy()
        {
            ShutdownServices();
        }

        public void RegisterService(IGameService service)
        {
            _services.Add(service);
            service.Initialize();
        }

        public void ChangeState(GameState newState)
        {
            if (CurrentState == newState) return;

            CurrentState = newState;
            OnStateChanged?.Invoke(newState);

            Debug.Log($"Game state changed to: {newState}");
        }

        public void StartGame()
        {
            ChangeState(GameState.Playing);
        }

        public void PauseGame()
        {
            if (CurrentState == GameState.Playing)
            {
                ChangeState(GameState.Paused);
                Time.timeScale = 0f;
            }
        }

        public void ResumeGame()
        {
            if (CurrentState == GameState.Paused)
            {
                ChangeState(GameState.Playing);
                Time.timeScale = 1f;
            }
        }

        public void EndGame()
        {
            ChangeState(GameState.GameOver);
            Time.timeScale = 1f;
        }

        private void InitializeServices()
        {
            foreach (var service in _services)
            {
                service.Initialize();
            }
        }

        private void ShutdownServices()
        {
            foreach (var service in _services)
            {
                service.Shutdown();
            }
        }
    }
}
