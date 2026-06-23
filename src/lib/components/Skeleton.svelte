<script lang="ts">
	/** Generic skeleton placeholder used while data is in flight. */
	export let width: string = '100%';
	export let height: string = '1em';
	export let radius: string = '4px';
</script>

<span class="sk" style:width style:height style:border-radius={radius} aria-hidden="true"></span>

<style>
	.sk {
		display: inline-block;
		background: linear-gradient(
			90deg,
			rgba(255, 255, 255, 0.04) 0%,
			rgba(255, 255, 255, 0.09) 50%,
			rgba(255, 255, 255, 0.04) 100%
		);
		background-size: 200% 100%;
		animation: shimmer 1.4s ease-in-out infinite;
	}
	@keyframes shimmer {
		0% {
			background-position: 100% 0;
		}
		100% {
			background-position: -100% 0;
		}
	}
</style>
