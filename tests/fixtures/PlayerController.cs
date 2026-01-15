using UnityEngine;
using System.Collections.Generic;

namespace Game.Player
{
    /// <summary>
    /// Controls player movement and input.
    /// </summary>
    [RequireComponent(typeof(Rigidbody))]
    [RequireComponent(typeof(CapsuleCollider))]
    public class PlayerController : MonoBehaviour
    {
        [Header("Movement Settings")]
        [SerializeField] private float moveSpeed = 5f;
        [SerializeField] private float jumpForce = 10f;
        [SerializeField] private float rotationSpeed = 720f;

        [Header("Ground Check")]
        [SerializeField] private Transform groundCheck;
        [SerializeField] private float groundDistance = 0.4f;
        [SerializeField] private LayerMask groundMask;

        public float Health { get; private set; } = 100f;
        public bool IsGrounded { get; private set; }
        public Vector3 Velocity => _rigidbody.velocity;

        private Rigidbody _rigidbody;
        private CapsuleCollider _collider;
        private Vector3 _moveDirection;
        private bool _shouldJump;

        private void Awake()
        {
            _rigidbody = GetComponent<Rigidbody>();
            _collider = GetComponent<CapsuleCollider>();
        }

        private void Start()
        {
            Debug.Log("PlayerController initialized");
        }

        private void Update()
        {
            HandleInput();
            CheckGround();
        }

        private void FixedUpdate()
        {
            Move(_moveDirection);

            if (_shouldJump && IsGrounded)
            {
                Jump();
                _shouldJump = false;
            }
        }

        public void Move(Vector3 direction)
        {
            if (direction.magnitude > 0.1f)
            {
                Vector3 targetVelocity = direction.normalized * moveSpeed;
                _rigidbody.velocity = new Vector3(targetVelocity.x, _rigidbody.velocity.y, targetVelocity.z);

                Quaternion targetRotation = Quaternion.LookRotation(direction);
                transform.rotation = Quaternion.RotateTowards(
                    transform.rotation,
                    targetRotation,
                    rotationSpeed * Time.fixedDeltaTime
                );
            }
        }

        public void Jump()
        {
            if (IsGrounded)
            {
                _rigidbody.AddForce(Vector3.up * jumpForce, ForceMode.Impulse);
            }
        }

        public void TakeDamage(float amount)
        {
            Health -= amount;
            if (Health <= 0)
            {
                Die();
            }
        }

        protected virtual void Die()
        {
            Debug.Log("Player died!");
            gameObject.SetActive(false);
        }

        private void HandleInput()
        {
            float horizontal = Input.GetAxisRaw("Horizontal");
            float vertical = Input.GetAxisRaw("Vertical");
            _moveDirection = new Vector3(horizontal, 0, vertical);

            if (Input.GetButtonDown("Jump"))
            {
                _shouldJump = true;
            }
        }

        private void CheckGround()
        {
            IsGrounded = Physics.CheckSphere(groundCheck.position, groundDistance, groundMask);
        }

        private void OnCollisionEnter(Collision collision)
        {
            if (collision.gameObject.CompareTag("Enemy"))
            {
                TakeDamage(10f);
            }
        }

        private void OnTriggerEnter(Collider other)
        {
            if (other.CompareTag("Pickup"))
            {
                Health = Mathf.Min(Health + 25f, 100f);
                Destroy(other.gameObject);
            }
        }
    }
}
